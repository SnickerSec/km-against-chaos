// Blackjack game engine. State lives in Redis (one JSON blob per lobby,
// keyed blackjack:{code}) when REDIS_URL is set, otherwise in a local Map.
// Public API is async throughout so every replica reads the same state.

import { redis, withGameLock } from "./redis.js";

// ── Configuration ────────────────────────────────────────────────────────────

export const BETTING_WINDOW_MS = 15_000;
export const TURN_TIME_MS = 30_000;
export const SETTLE_DELAY_MS = 5_000;

// ── Types ────────────────────────────────────────────────────────────────────

export type Suit = "S" | "H" | "D" | "C";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export interface Card { suit: Suit; rank: Rank }

export type BlackjackPhase = "betting" | "dealing" | "playing" | "dealer" | "settle" | "gameOver";

export interface Hand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  resolved: boolean;
  fromSplit: boolean;          // true on hands created by split — blocks re-split
}

export type Outcome = "win" | "lose" | "push" | "blackjack";
export interface Settlement {
  playerId: string;
  handIndex: number;
  outcome: Outcome;
  delta: number;               // chips returned to player on settle (0 for lose)
}

export interface BlackjackConfig {
  startingChips: number;
  minBet: number;
  maxBet: number;
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
}

export async function getBlackjackPlayerView(
  lobbyCode: string,
  _playerId: string,
): Promise<BlackjackPlayerView | null> {
  const g = await loadGame(lobbyCode);
  if (!g) return null;

  // Hide the dealer's hole card during 'playing'. Reveal it from 'dealer'
  // onward so the client can animate the draw sequence.
  const hideHoleCard = g.phase === "playing" || g.phase === "dealing";
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
  };
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
