// Blackjack game engine. State lives in Redis (one JSON blob per lobby,
// keyed blackjack:{code}) when REDIS_URL is set, otherwise in a local Map.
// Public API is async throughout so every replica reads the same state.

import { redis, withGameLock } from "./redis.js";

// ── Configuration ────────────────────────────────────────────────────────────

export const BETTING_WINDOW_MS = 15_000;
export const INSURANCE_WINDOW_MS = 10_000;
export const TURN_TIME_MS = 30_000;
export const SETTLE_DELAY_MS = 5_000;

// ── Types ────────────────────────────────────────────────────────────────────

export type Suit = "S" | "H" | "D" | "C";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export interface Card { suit: Suit; rank: Rank }

export type BlackjackPhase = "betting" | "dealing" | "insurance" | "playing" | "dealer" | "settle" | "gameOver";

export interface Hand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  resolved: boolean;
  fromSplit: boolean;          // true on hands created by split — blocks re-split
  surrendered?: boolean;       // true when the player surrenders before acting
}

export type Outcome = "win" | "lose" | "push" | "blackjack" | "surrender";
export interface Settlement {
  playerId: string;
  handIndex: number;
  outcome: Outcome;
  delta: number;               // chips returned to player on settle (0 for lose)
}

export type InsuranceOutcome = "won" | "lost" | "declined";
export interface InsuranceSettlement {
  playerId: string;
  amount: number;              // the insurance stake (floor(mainBet/2)); 0 for declined
  outcome: InsuranceOutcome;
  delta: number;               // chips returned (3× stake on win, 0 on lose/declined)
}

export type BlackjackWinCondition =
  | { mode: "elimination" }
  | { mode: "timed"; durationMs: number };

export interface BlackjackConfig {
  startingChips: number;
  minBet: number;
  maxBet: number;
  winCondition?: BlackjackWinCondition;
}

interface InternalBlackjackGame {
  lobbyCode: string;
  shoe: Card[];                                  // top of deck = end of array (popped)
  playerIds: string[];                           // seat order
  chips: Record<string, number>;                 // per-player current balance
  config: BlackjackConfig;
  phase: BlackjackPhase;
  bets: Record<string, number | "sitting_out" | null>;  // null = no bet yet this round
  hands: Record<string, Hand[]>;
  dealerHand: Card[];
  activePlayerIndex: number;
  activeHandIndex: number;
  phaseDeadline: number;                         // epoch ms — keys at-most-once timer lock
  roundNumber: number;
  lastSettlement?: Settlement[];
  createdAt: number;                             // epoch ms — zombie-restore filter
  // Only populated while phase === "insurance"; cleared in startNextRound.
  insuranceDecisions?: Record<string, "insured" | "declined" | null>;
  insuranceSettlement?: InsuranceSettlement[];
}

// ── Storage ──────────────────────────────────────────────────────────────────

const KEY = (code: string) => `blackjack:${code}`;
const local = new Map<string, InternalBlackjackGame>();

async function loadGame(code: string): Promise<InternalBlackjackGame | undefined> {
  if (redis) {
    const json = await redis.get(KEY(code));
    return json ? JSON.parse(json) as InternalBlackjackGame : undefined;
  }
  return local.get(code);
}

async function saveGame(game: InternalBlackjackGame): Promise<void> {
  if (redis) {
    await redis.set(KEY(game.lobbyCode), JSON.stringify(game));
    return;
  }
  local.set(game.lobbyCode, game);
}

async function deleteGame(code: string): Promise<void> {
  if (redis) {
    await redis.del(KEY(code));
    return;
  }
  local.delete(code);
}

async function gameExists(code: string): Promise<boolean> {
  if (redis) return (await redis.exists(KEY(code))) === 1;
  return local.has(code);
}

async function getAllGames(): Promise<InternalBlackjackGame[]> {
  if (redis) {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", "blackjack:*", "COUNT", 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
    if (keys.length === 0) return [];
    const raws = await redis.mget(...keys);
    return raws.filter((r): r is string => !!r).map(r => JSON.parse(r) as InternalBlackjackGame);
  }
  return Array.from(local.values());
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SUITS: Suit[] = ["S", "H", "D", "C"];
const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function isPair(cards: Card[]): boolean {
  return cards.length === 2 && cards[0].rank === cards[1].rank;
}

function freshShoe(): Card[] {
  const shoe: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) shoe.push({ suit: s, rank: r });
  return shuffle(shoe);
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function allBetsIn(g: InternalBlackjackGame): boolean {
  return g.playerIds.every(pid => g.bets[pid] !== null);
}

function dealOne(g: InternalBlackjackGame): Card {
  const c = g.shoe.pop();
  if (!c) throw new Error("blackjack: shoe empty (should be reshuffled before any hand)");
  return c;
}

function startDealing(g: InternalBlackjackGame): void {
  g.phase = "dealing";
  // Build hands for every player who placed a numeric bet. Sitting-out players
  // get no hand this round.
  for (const pid of g.playerIds) {
    if (typeof g.bets[pid] === "number") {
      g.hands[pid] = [{ cards: [], bet: g.bets[pid] as number, doubled: false, resolved: false, fromSplit: false }];
    } else {
      g.hands[pid] = [];
    }
  }
  // Two cards each, classic round-the-table order: every player gets one,
  // then dealer one (face-up), then every player one more, then dealer one
  // (face-down hole card). For a Redis blob this ordering doesn't actually
  // matter — but we keep it for parity with how the client will animate.
  g.dealerHand = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const pid of g.playerIds) {
      if (g.hands[pid].length > 0) g.hands[pid][0].cards.push(dealOne(g));
    }
    g.dealerHand.push(dealOne(g));
  }
  // If literally everyone is sitting out, jump to dealer phase (which will
  // immediately settle with no payouts).
  if (!g.playerIds.some(pid => g.hands[pid].length > 0)) {
    g.phase = "dealer";
    return;
  }

  // Dealer showing an Ace → insurance window before play begins. Players who
  // bet get to opt in for floor(bet/2) that pays 2:1 if dealer has blackjack.
  if (g.dealerHand[0].rank === "A") {
    g.phase = "insurance";
    g.insuranceDecisions = {};
    for (const pid of g.playerIds) {
      if (typeof g.bets[pid] === "number") {
        g.insuranceDecisions[pid] = null;
      }
    }
    g.phaseDeadline = Date.now() + INSURANCE_WINDOW_MS;
    return;
  }

  enterPlaying(g);
}

/**
 * Move into the playing phase with the first non-sitting-out seat active.
 * Shared between startDealing (no-insurance path) and resolveInsurance
 * (dealer didn't have blackjack).
 */
function enterPlaying(g: InternalBlackjackGame): void {
  g.phase = "playing";
  g.activePlayerIndex = g.playerIds.findIndex(pid => g.hands[pid].length > 0);
  g.activeHandIndex = 0;
  g.phaseDeadline = Date.now() + TURN_TIME_MS;
  if (g.activePlayerIndex === -1) g.phase = "dealer";
}

// ── Hand evaluation ──────────────────────────────────────────────────────────

const RANK_VALUE: Record<Rank, number> = {
  "A": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  "10": 10, "J": 10, "Q": 10, "K": 10,
};

/** Best non-bust total — counts an Ace as 11 if it doesn't bust. */
export function handValue(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += RANK_VALUE[c.rank];
    if (c.rank === "A") aces++;
  }
  while (aces > 0 && total + 10 <= 21) { total += 10; aces--; }
  return total;
}

function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

function activeHand(g: InternalBlackjackGame): { pid: string; hand: Hand } | null {
  const pid = g.playerIds[g.activePlayerIndex];
  if (!pid) return null;
  const hands = g.hands[pid];
  if (!hands || g.activeHandIndex >= hands.length) return null;
  return { pid, hand: hands[g.activeHandIndex] };
}

/** Move to the next playable hand, or to the dealer phase if no hands remain. */
function advanceTurn(g: InternalBlackjackGame): void {
  // Try the next unresolved hand of the current player. Split-aces marks both
  // new hands resolved up front, so we have to skip resolved hands rather
  // than just incrementing the index.
  const curPid = g.playerIds[g.activePlayerIndex];
  if (curPid) {
    const hands = g.hands[curPid] || [];
    for (let i = g.activeHandIndex + 1; i < hands.length; i++) {
      if (!hands[i].resolved) {
        g.activeHandIndex = i;
        g.phaseDeadline = Date.now() + TURN_TIME_MS;
        return;
      }
    }
  }
  // Otherwise advance to the next seat that has any unresolved hand.
  for (let i = g.activePlayerIndex + 1; i < g.playerIds.length; i++) {
    const hands = g.hands[g.playerIds[i]] || [];
    if (hands.some(h => !h.resolved)) {
      g.activePlayerIndex = i;
      g.activeHandIndex = hands.findIndex(h => !h.resolved);
      g.phaseDeadline = Date.now() + TURN_TIME_MS;
      return;
    }
  }
  // All players done — dealer phase. Settle is handled in T11/T12.
  g.phase = "dealer";
  g.activePlayerIndex = -1;
  g.activeHandIndex = 0;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function createBlackjackGame(
  lobbyCode: string,
  playerIds: string[],
  config: BlackjackConfig,
): Promise<void> {
  if (playerIds.length < 1) throw new Error("createBlackjackGame: need at least 1 player");

  const chips: Record<string, number> = {};
  const bets: Record<string, number | "sitting_out" | null> = {};
  const hands: Record<string, Hand[]> = {};
  for (const pid of playerIds) {
    chips[pid] = config.startingChips;
    bets[pid] = null;
    hands[pid] = [];
  }

  const game: InternalBlackjackGame = {
    lobbyCode,
    shoe: freshShoe(),
    playerIds,
    chips,
    config,
    phase: "betting",
    bets,
    hands,
    dealerHand: [],
    activePlayerIndex: 0,
    activeHandIndex: 0,
    phaseDeadline: Date.now() + BETTING_WINDOW_MS,
    roundNumber: 1,
    createdAt: Date.now(),
  };

  await saveGame(game);
}

export interface BlackjackPlayerView {
  gameType: "blackjack";
  phase: BlackjackPhase;
  chips: Record<string, number>;
  bets: Record<string, number | "sitting_out" | null>;
  hands: Record<string, Hand[]>;
  dealerHand: Array<Card | { suit: "?"; rank: "?" }>;
  playerIds: string[];
  config: BlackjackConfig;
  activePlayerId: string | null;
  activeHandIndex: number;
  roundNumber: number;
  phaseDeadline: number;
  shoeRemaining: number;
  lastSettlement?: Settlement[];
  insuranceDecisions?: Record<string, "insured" | "declined" | null>;
  insuranceSettlement?: InsuranceSettlement[];
}

export async function getBlackjackPlayerView(
  lobbyCode: string,
  _playerId: string,
): Promise<BlackjackPlayerView | null> {
  const g = await loadGame(lobbyCode);
  if (!g) return null;

  // Hide the dealer's hole card during 'playing' and 'insurance' (the peek
  // hasn't happened yet in insurance). Reveal it from 'dealer' onward so the
  // client can animate the flip and the draw sequence.
  const hideHoleCard = g.phase === "playing" || g.phase === "dealing" || g.phase === "insurance";
  const dealerHand: Array<Card | { suit: "?"; rank: "?" }> =
    hideHoleCard && g.dealerHand.length >= 2
      ? [g.dealerHand[0], { suit: "?", rank: "?" }, ...g.dealerHand.slice(2)]
      : g.dealerHand;

  return {
    gameType: "blackjack",
    phase: g.phase,
    chips: g.chips,
    bets: g.bets,
    hands: g.hands,
    dealerHand,
    playerIds: g.playerIds,
    config: g.config,
    activePlayerId: g.phase === "playing" ? g.playerIds[g.activePlayerIndex] ?? null : null,
    activeHandIndex: g.activeHandIndex,
    roundNumber: g.roundNumber,
    phaseDeadline: g.phaseDeadline,
    shoeRemaining: g.shoe.length,
    lastSettlement: g.lastSettlement,
    insuranceDecisions: g.insuranceDecisions,
    insuranceSettlement: g.insuranceSettlement,
  };
}

type ActionResult = { success: true } | { success: false; error: string };

export async function placeBet(
  lobbyCode: string,
  playerId: string,
  amount: number,
): Promise<ActionResult> {
  return withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return { success: false, error: "Game not found" };
    if (g.phase !== "betting") return { success: false, error: "Not the betting phase" };
    if (!g.playerIds.includes(playerId)) return { success: false, error: "Not in this game" };
    if (g.bets[playerId] !== null) return { success: false, error: "Already submitted this round" };
    if (!Number.isInteger(amount)) return { success: false, error: "Bet must be a whole number" };
    if (amount < g.config.minBet) return { success: false, error: `Bet below table min (${g.config.minBet})` };
    if (amount > g.config.maxBet) return { success: false, error: `Bet above table max (${g.config.maxBet})` };
    if (amount > g.chips[playerId]) return { success: false, error: "Not enough chips" };

    g.chips[playerId] -= amount;
    g.bets[playerId] = amount;
    if (allBetsIn(g)) startDealing(g);
    await saveGame(g);
    return { success: true };
  });
}

export async function sitOut(lobbyCode: string, playerId: string): Promise<ActionResult> {
  return withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return { success: false, error: "Game not found" };
    if (g.phase !== "betting") return { success: false, error: "Not the betting phase" };
    if (!g.playerIds.includes(playerId)) return { success: false, error: "Not in this game" };
    if (g.bets[playerId] !== null) return { success: false, error: "Already submitted this round" };

    g.bets[playerId] = "sitting_out";
    if (allBetsIn(g)) startDealing(g);
    await saveGame(g);
    return { success: true };
  });
}

/**
 * Resolve the insurance window: peek the dealer's hole card. If it's a
 * blackjack, insured players win 2:1 on their insurance stake and the round
 * jumps straight to settle (skipping play). Otherwise insurance bets are
 * forfeit and play proceeds normally.
 */
function resolveInsurance(g: InternalBlackjackGame): void {
  const dealerBJ = isBlackjack(g.dealerHand);
  const settlements: InsuranceSettlement[] = [];

  for (const pid of g.playerIds) {
    const decision = g.insuranceDecisions?.[pid];
    if (decision == null) continue; // wasn't eligible (sitting out / undecided gets flipped to declined first)

    const mainBet = typeof g.bets[pid] === "number" ? g.bets[pid] as number : 0;
    const amount = Math.floor(mainBet / 2);

    if (decision === "declined") {
      settlements.push({ playerId: pid, amount: 0, outcome: "declined", delta: 0 });
      continue;
    }

    // decision === "insured" — amount was already deducted when they accepted.
    if (dealerBJ) {
      const delta = amount * 3; // stake returned + 2:1 winnings
      g.chips[pid] += delta;
      settlements.push({ playerId: pid, amount, outcome: "won", delta });
    } else {
      settlements.push({ playerId: pid, amount, outcome: "lost", delta: 0 });
    }
  }

  g.insuranceSettlement = settlements;
  g.insuranceDecisions = undefined;

  if (dealerBJ) {
    g.phase = "settle";
    g.phaseDeadline = Date.now() + SETTLE_DELAY_MS;
  } else {
    enterPlaying(g);
  }
}

/** True once every eligible player has chosen insured or declined. */
function allInsuranceDecided(g: InternalBlackjackGame): boolean {
  if (!g.insuranceDecisions) return true;
  return Object.values(g.insuranceDecisions).every(v => v !== null);
}

export async function placeInsurance(lobbyCode: string, playerId: string): Promise<ActionResult> {
  return withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return { success: false, error: "Game not found" };
    if (g.phase !== "insurance") return { success: false, error: "Not the insurance phase" };
    if (!g.insuranceDecisions || !(playerId in g.insuranceDecisions)) {
      return { success: false, error: "Not eligible for insurance this round" };
    }
    if (g.insuranceDecisions[playerId] !== null) return { success: false, error: "Already decided" };

    const mainBet = typeof g.bets[playerId] === "number" ? g.bets[playerId] as number : 0;
    const amount = Math.floor(mainBet / 2);
    if (amount <= 0) return { success: false, error: "Insurance stake too small" };
    if (g.chips[playerId] < amount) return { success: false, error: "Not enough chips for insurance" };

    g.chips[playerId] -= amount;
    g.insuranceDecisions[playerId] = "insured";

    if (allInsuranceDecided(g)) resolveInsurance(g);

    await saveGame(g);
    return { success: true };
  });
}

export async function declineInsurance(lobbyCode: string, playerId: string): Promise<ActionResult> {
  return withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return { success: false, error: "Game not found" };
    if (g.phase !== "insurance") return { success: false, error: "Not the insurance phase" };
    if (!g.insuranceDecisions || !(playerId in g.insuranceDecisions)) {
      return { success: false, error: "Not eligible for insurance this round" };
    }
    if (g.insuranceDecisions[playerId] !== null) return { success: false, error: "Already decided" };

    g.insuranceDecisions[playerId] = "declined";

    if (allInsuranceDecided(g)) resolveInsurance(g);

    await saveGame(g);
    return { success: true };
  });
}

export async function handleInsuranceTimeout(lobbyCode: string): Promise<void> {
  await withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return;
    if (g.phase !== "insurance") return;

    if (g.insuranceDecisions) {
      for (const pid of Object.keys(g.insuranceDecisions)) {
        if (g.insuranceDecisions[pid] === null) g.insuranceDecisions[pid] = "declined";
      }
    }
    resolveInsurance(g);
    await saveGame(g);
  });
}

export async function hit(lobbyCode: string, playerId: string): Promise<ActionResult> {
  return withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return { success: false, error: "Game not found" };
    if (g.phase !== "playing") return { success: false, error: "Not the playing phase" };
    const cur = activeHand(g);
    if (!cur || cur.pid !== playerId) return { success: false, error: "Not your turn" };

    cur.hand.cards.push(dealOne(g));
    if (handValue(cur.hand.cards) > 21) {
      cur.hand.resolved = true;
      advanceTurn(g);
    }
    await saveGame(g);
    return { success: true };
  });
}

export async function stand(lobbyCode: string, playerId: string): Promise<ActionResult> {
  return withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return { success: false, error: "Game not found" };
    if (g.phase !== "playing") return { success: false, error: "Not the playing phase" };
    const cur = activeHand(g);
    if (!cur || cur.pid !== playerId) return { success: false, error: "Not your turn" };

    cur.hand.resolved = true;
    advanceTurn(g);
    await saveGame(g);
    return { success: true };
  });
}

/**
 * Surrender: the player forfeits the hand before taking any other action
 * (hit / double / split), getting half their bet back on settlement. Classic
 * "early surrender" isn't supported — the server already checks dealer BJ
 * before payouts anyway, so this is late surrender in practice.
 */
export async function surrender(lobbyCode: string, playerId: string): Promise<ActionResult> {
  return withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return { success: false, error: "Game not found" };
    if (g.phase !== "playing") return { success: false, error: "Not the playing phase" };
    const cur = activeHand(g);
    if (!cur || cur.pid !== playerId) return { success: false, error: "Not your turn" };
    if (cur.hand.cards.length !== 2) return { success: false, error: "Surrender only legal on a fresh 2-card hand" };
    if (cur.hand.fromSplit) return { success: false, error: "Cannot surrender a split hand" };

    cur.hand.surrendered = true;
    cur.hand.resolved = true;
    advanceTurn(g);
    await saveGame(g);
    return { success: true };
  });
}

export async function doubleDown(lobbyCode: string, playerId: string): Promise<ActionResult> {
  return withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return { success: false, error: "Game not found" };
    if (g.phase !== "playing") return { success: false, error: "Not the playing phase" };
    const cur = activeHand(g);
    if (!cur || cur.pid !== playerId) return { success: false, error: "Not your turn" };
    if (cur.hand.cards.length !== 2) return { success: false, error: "Double only legal on a 2-card hand" };
    if (g.chips[playerId] < cur.hand.bet) return { success: false, error: "Not enough chips to double" };

    g.chips[playerId] -= cur.hand.bet;
    cur.hand.bet *= 2;
    cur.hand.doubled = true;
    cur.hand.cards.push(dealOne(g));
    cur.hand.resolved = true;
    advanceTurn(g);
    await saveGame(g);
    return { success: true };
  });
}

export async function split(lobbyCode: string, playerId: string): Promise<ActionResult> {
  return withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return { success: false, error: "Game not found" };
    if (g.phase !== "playing") return { success: false, error: "Not the playing phase" };
    const cur = activeHand(g);
    if (!cur || cur.pid !== playerId) return { success: false, error: "Not your turn" };
    if (cur.hand.fromSplit) return { success: false, error: "Re-split is not allowed" };
    if (!isPair(cur.hand.cards)) return { success: false, error: "Split only legal on a pair" };
    if (g.chips[playerId] < cur.hand.bet) return { success: false, error: "Not enough chips to split" };

    const original = cur.hand;
    const isAcePair = original.cards[0].rank === "A";

    g.chips[playerId] -= original.bet;
    const handA: Hand = { cards: [original.cards[0], dealOne(g)], bet: original.bet, doubled: false, resolved: false, fromSplit: true };
    const handB: Hand = { cards: [original.cards[1], dealOne(g)], bet: original.bet, doubled: false, resolved: false, fromSplit: true };

    // Split aces auto-resolve both hands (T10 will pin this with its own test).
    if (isAcePair) {
      handA.resolved = true;
      handB.resolved = true;
    }

    g.hands[playerId] = [handA, handB];
    g.activeHandIndex = 0;
    g.phaseDeadline = Date.now() + TURN_TIME_MS;

    if (isAcePair) advanceTurn(g);  // Both hands done → next player

    await saveGame(g);
    return { success: true };
  });
}

function anyLiveHand(g: InternalBlackjackGame): boolean {
  for (const pid of g.playerIds) {
    for (const h of g.hands[pid] || []) {
      if (handValue(h.cards) <= 21) return true;
    }
  }
  return false;
}

export async function runDealer(lobbyCode: string): Promise<void> {
  await withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return;
    if (g.phase !== "dealer") return;

    // Skip drawing if every player busted — dealer wins by default.
    if (anyLiveHand(g)) {
      while (handValue(g.dealerHand) < 17) {
        g.dealerHand.push(dealOne(g));
      }
    }

    g.phase = "settle";
    g.phaseDeadline = Date.now() + SETTLE_DELAY_MS;
    await saveGame(g);
  });
}

function classifyHand(hand: Hand, dealerTotal: number, dealerBlackjack: boolean): Outcome {
  if (hand.surrendered) return "surrender";
  const playerTotal = handValue(hand.cards);
  const playerBlackjack = isBlackjack(hand.cards) && !hand.fromSplit;
  if (playerTotal > 21) return "lose";
  if (playerBlackjack && dealerBlackjack) return "push";
  if (playerBlackjack) return "blackjack";
  if (dealerBlackjack) return "lose";
  if (dealerTotal > 21) return "win";
  if (playerTotal > dealerTotal) return "win";
  if (playerTotal === dealerTotal) return "push";
  return "lose";
}

export async function settleRound(lobbyCode: string): Promise<void> {
  await withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return;
    if (g.phase !== "settle") return;

    const dealerTotal = handValue(g.dealerHand);
    const dealerBJ = isBlackjack(g.dealerHand);
    const settlements: Settlement[] = [];

    for (const pid of g.playerIds) {
      const hands = g.hands[pid] || [];
      for (let i = 0; i < hands.length; i++) {
        const h = hands[i];
        const outcome = classifyHand(h, dealerTotal, dealerBJ);
        let delta = 0;
        switch (outcome) {
          case "win":       delta = 2 * h.bet; break;
          case "blackjack": delta = h.bet + Math.ceil(1.5 * h.bet); break;
          case "push":      delta = h.bet; break;
          case "lose":      delta = 0; break;
          case "surrender": delta = Math.floor(h.bet / 2); break;
        }
        g.chips[pid] += delta;
        settlements.push({ playerId: pid, handIndex: i, outcome, delta });
      }
    }

    g.lastSettlement = settlements;
    // Phase advances in T13 (auto-loop or game over)
    await saveGame(g);
  });
}

function eligible(g: InternalBlackjackGame, pid: string): boolean {
  return (g.chips[pid] ?? 0) >= g.config.minBet;
}

function timedExpired(g: InternalBlackjackGame): boolean {
  const wc = g.config.winCondition;
  if (!wc || wc.mode !== "timed") return false;
  return Date.now() - g.createdAt >= wc.durationMs;
}

export async function startNextRound(lobbyCode: string): Promise<void> {
  await withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return;
    if (g.phase !== "settle") return;

    const eligibleCount = g.playerIds.filter(p => eligible(g, p)).length;
    if (eligibleCount <= 1 || timedExpired(g)) {
      g.phase = "gameOver";
      g.phaseDeadline = Date.now();
      await saveGame(g);
      return;
    }

    g.roundNumber++;
    g.shoe = freshShoe();
    g.dealerHand = [];
    g.bets = {};
    g.hands = {};
    for (const pid of g.playerIds) {
      g.bets[pid] = eligible(g, pid) ? null : "sitting_out";
      g.hands[pid] = [];
    }
    g.phase = "betting";
    g.activePlayerIndex = 0;
    g.activeHandIndex = 0;
    g.phaseDeadline = Date.now() + BETTING_WINDOW_MS;
    g.lastSettlement = undefined;
    g.insuranceDecisions = undefined;
    g.insuranceSettlement = undefined;
    await saveGame(g);
  });
}

export async function getBlackjackScores(lobbyCode: string): Promise<Record<string, number> | null> {
  const g = await loadGame(lobbyCode);
  if (!g) return null;
  const out: Record<string, number> = {};
  // Timed mode: chip leader wins (the elimination rule never fires unless
  // everyone but one player is broke by the buzzer).
  if (g.config.winCondition?.mode === "timed") {
    const top = [...g.playerIds].sort((a, b) => (g.chips[b] ?? 0) - (g.chips[a] ?? 0))[0];
    for (const pid of g.playerIds) out[pid] = pid === top ? 1 : 0;
    return out;
  }
  // Elimination: last player standing gets 1; others 0.
  const survivors = g.playerIds.filter(p => eligible(g, p));
  for (const pid of g.playerIds) out[pid] = survivors.includes(pid) ? 1 : 0;
  // Tie-break: if multiple eligible players (gameOver shouldn't fire then,
  // but defensively) award 1 to the highest chip count.
  if (survivors.length > 1) {
    const top = survivors.sort((a, b) => (g.chips[b] ?? 0) - (g.chips[a] ?? 0))[0];
    for (const pid of g.playerIds) out[pid] = pid === top ? 1 : 0;
  }
  return out;
}

export async function getBlackjackTurnDeadline(lobbyCode: string): Promise<number | null> {
  const g = await loadGame(lobbyCode);
  if (!g) return null;
  return g.phaseDeadline;
}

export async function isBlackjackGame(lobbyCode: string): Promise<boolean> {
  return gameExists(lobbyCode);
}

export async function cleanupBlackjackGame(lobbyCode: string): Promise<void> {
  await deleteGame(lobbyCode);
}

export async function exportBlackjackGames(): Promise<any[]> {
  return getAllGames();
}

const ABANDONED_GAME_AGE_MS = 2 * 60 * 60 * 1000; // 2h since creation → zombie

export async function restoreBlackjackGames(snapshots: any[]): Promise<void> {
  for (const s of snapshots) {
    const game = s as InternalBlackjackGame;
    if (game.createdAt && Date.now() - game.createdAt > ABANDONED_GAME_AGE_MS) {
      continue;
    }
    await saveGame(game);
  }
}

/**
 * Called when the betting-phase deadline fires. Any player who hasn't chosen
 * (bet or sit-out) is treated as sitting out. Then deal the round.
 */
export async function handleBettingTimeout(lobbyCode: string): Promise<void> {
  await withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return;
    if (g.phase !== "betting") return;

    for (const pid of g.playerIds) {
      if (g.bets[pid] === null) g.bets[pid] = "sitting_out";
    }
    startDealing(g);
    await saveGame(g);
  });
}

/**
 * Called when the turn-phase deadline fires. The active hand auto-stands so
 * the table keeps moving even if a player disconnects or goes AFK.
 */
export async function handleTurnTimeout(lobbyCode: string): Promise<void> {
  await withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return;
    if (g.phase !== "playing") return;
    const cur = activeHand(g);
    if (!cur) return;

    cur.hand.resolved = true;
    advanceTurn(g);
    await saveGame(g);
  });
}

/**
 * Bot action: place the minimum bet. Safe to call repeatedly — no-ops if the
 * bot has already bet or the phase isn't betting.
 */
export async function botPlaceBet(lobbyCode: string, botId: string): Promise<ActionResult> {
  return withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return { success: false, error: "Game not found" };
    if (g.phase !== "betting") return { success: false, error: "Not betting phase" };
    if (!g.playerIds.includes(botId)) return { success: false, error: "Not in game" };
    if (g.bets[botId] !== null) return { success: false, error: "Already bet" };

    if (g.chips[botId] < g.config.minBet) {
      g.bets[botId] = "sitting_out";
    } else {
      const amount = g.config.minBet;
      g.chips[botId] -= amount;
      g.bets[botId] = amount;
    }
    if (allBetsIn(g)) startDealing(g);
    await saveGame(g);
    return { success: true };
  });
}

/**
 * Basic blackjack strategy for the H17 multi-deck ruleset this table uses.
 * Returns the optimal single action for a hand given the dealer's upcard.
 * Callers pass canDouble/canSplit so the strategy can fall back to hit/stand
 * when the chip stack or rules don't permit the preferred action.
 */
export function basicStrategy(
  cards: Card[],
  upcard: number,
  canDouble: boolean,
  canSplit: boolean,
): "hit" | "stand" | "double" | "split" {
  // Pairs evaluated before totals — splitting turns them into two hands.
  if (canSplit && cards.length === 2 && cards[0].rank === cards[1].rank) {
    const r = cards[0].rank;
    if (r === "A" || r === "8") return "split";
    if (r === "10" || r === "J" || r === "Q" || r === "K") {
      // Never split 20 — stand pat (falls through to stand via hard total).
    } else if (r === "9") {
      return (upcard === 7 || upcard >= 10) ? "stand" : "split";
    } else if (r === "7" || r === "3" || r === "2") {
      if (upcard <= 7) return "split";
      // else fall through to hard-total logic below
    } else if (r === "6") {
      if (upcard <= 6) return "split";
    } else if (r === "4") {
      if (upcard === 5 || upcard === 6) return "split";
    }
    // r === "5" falls through — treat pair of 5s as hard 10 below.
  }

  const total = handValue(cards);

  // A hand is "soft" when it contains an Ace counted as 11 (i.e. the Ace could
  // still drop to 1 without busting).
  const acesAsOne = cards.reduce(
    (sum, c) => sum + (c.rank === "A" ? 1 : RANK_VALUE[c.rank]),
    0,
  );
  const isSoft = cards.some(c => c.rank === "A") && total === acesAsOne + 10;

  if (isSoft) {
    if (total >= 19) return "stand";                                   // A8, A9
    if (total === 18) {                                                // A7
      if (canDouble && upcard >= 3 && upcard <= 6) return "double";
      if (upcard >= 9) return "hit";
      return "stand";
    }
    if (total === 17) {                                                // A6
      if (canDouble && upcard >= 3 && upcard <= 6) return "double";
      return "hit";
    }
    if (total === 15 || total === 16) {                                // A4, A5
      if (canDouble && upcard >= 4 && upcard <= 6) return "double";
      return "hit";
    }
    if (total === 13 || total === 14) {                                // A2, A3
      if (canDouble && upcard >= 5 && upcard <= 6) return "double";
      return "hit";
    }
  }

  // Hard totals
  if (total >= 17) return "stand";
  if (total >= 13) return upcard <= 6 ? "stand" : "hit";
  if (total === 12) return (upcard >= 4 && upcard <= 6) ? "stand" : "hit";
  if (total === 11) return canDouble ? "double" : "hit";               // always double 11
  if (total === 10) {
    if (canDouble && upcard >= 2 && upcard <= 9) return "double";
    return "hit";
  }
  if (total === 9) {
    if (canDouble && upcard >= 3 && upcard <= 6) return "double";
    return "hit";
  }
  return "hit"; // 4-8
}

function dealerUpcardValue(dealerHand: Card[]): number {
  const card = dealerHand[0];
  // Defensive: if the upcard isn't set yet (shouldn't happen in the playing
  // phase), assume a strong 10 so the bot plays the conservative line.
  if (!card) return 10;
  if (card.rank === "A") return 11;
  return RANK_VALUE[card.rank];
}

/**
 * Bot action: play the active hand (and any split children) using basic
 * strategy. On split, the new hands are played in the same call so the turn
 * resolves end-to-end. The iteration cap prevents a broken shoe or other
 * invariant violation from spinning forever.
 */
export async function botPlayTurn(lobbyCode: string, botId: string): Promise<ActionResult> {
  return withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return { success: false, error: "Game not found" };
    if (g.phase !== "playing") return { success: false, error: "Not playing phase" };

    const upcard = dealerUpcardValue(g.dealerHand);

    for (let iter = 0; iter < 40; iter++) {
      const cur = activeHand(g);
      if (!cur || cur.pid !== botId) break;
      const hand = cur.hand;

      // Split-aces pre-resolve both halves; skip past them.
      if (hand.resolved) { advanceTurn(g); continue; }

      const total = handValue(hand.cards);
      if (total >= 21) { hand.resolved = true; advanceTurn(g); continue; }

      const canDouble = hand.cards.length === 2 && g.chips[botId] >= hand.bet;
      const canSplit =
        hand.cards.length === 2 &&
        hand.cards[0].rank === hand.cards[1].rank &&
        !hand.fromSplit &&
        g.chips[botId] >= hand.bet;

      const decision = basicStrategy(hand.cards, upcard, canDouble, canSplit);

      if (decision === "stand") {
        hand.resolved = true;
        advanceTurn(g);
        continue;
      }

      if (decision === "hit") {
        if (g.shoe.length === 0) { hand.resolved = true; advanceTurn(g); continue; }
        hand.cards.push(dealOne(g));
        if (handValue(hand.cards) > 21) {
          hand.resolved = true;
          advanceTurn(g);
        }
        continue;
      }

      if (decision === "double") {
        g.chips[botId] -= hand.bet;
        hand.bet *= 2;
        hand.doubled = true;
        hand.cards.push(dealOne(g));
        hand.resolved = true;
        advanceTurn(g);
        continue;
      }

      if (decision === "split") {
        const isAcePair = hand.cards[0].rank === "A";
        g.chips[botId] -= hand.bet;
        const handA: Hand = {
          cards: [hand.cards[0], dealOne(g)],
          bet: hand.bet, doubled: false, resolved: isAcePair, fromSplit: true,
        };
        const handB: Hand = {
          cards: [hand.cards[1], dealOne(g)],
          bet: hand.bet, doubled: false, resolved: isAcePair, fromSplit: true,
        };
        g.hands[botId] = [handA, handB];
        g.activeHandIndex = 0;
        g.phaseDeadline = Date.now() + TURN_TIME_MS;
        if (isAcePair) advanceTurn(g);
        continue;
      }
    }

    await saveGame(g);
    return { success: true };
  });
}

export async function removePlayerFromBlackjackGame(
  lobbyCode: string,
  playerId: string,
): Promise<void> {
  await withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return;
    if (!g.playerIds.includes(playerId)) return;

    const wasActive = g.phase === "playing" && g.playerIds[g.activePlayerIndex] === playerId;

    // Drop the player from every per-player record.
    g.playerIds = g.playerIds.filter(p => p !== playerId);
    delete g.chips[playerId];
    delete g.bets[playerId];
    delete g.hands[playerId];

    // If they were active, advance. activePlayerIndex was an index into the
    // old playerIds — after splice, the same index now points at the next
    // seat (or off the end if they were last).
    if (wasActive) {
      if (g.activePlayerIndex >= g.playerIds.length) {
        g.phase = "dealer";
        g.activePlayerIndex = -1;
        g.activeHandIndex = 0;
      } else {
        g.activeHandIndex = 0;
        g.phaseDeadline = Date.now() + TURN_TIME_MS;
      }
    }

    // End the game if only one eligible player remains.
    const eligibleCount = g.playerIds.filter(p => eligible(g, p)).length;
    if (eligibleCount <= 1) {
      g.phase = "gameOver";
      g.phaseDeadline = Date.now();
    }

    await saveGame(g);
  });
}
