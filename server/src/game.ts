import type {
  ChaosCard,
  KnowledgeCard,
  Submission,
  RoundState,
  GameState,
  PlayerGameView,
  MetaEffect,
  MetaTarget,
  GameType,
} from "./types.js";
import { CHAOS_CARDS, KNOWLEDGE_CARDS, shuffled } from "./deck.js";
import { redis, withGameLock } from "./redis.js";

const HAND_SIZE = 7;
const DEFAULT_MAX_ROUNDS = 10;

// Superfight: each player holds 3 characters + 3 attributes and picks one of
// each per round. The existing knowledgeDeck/knowledgeDiscard hold attributes;
// characters live in their own pool so refills stay role-correct.
const SF_CHARACTER_COUNT = 3;
const SF_ATTRIBUTE_COUNT = 3;

interface InternalGameState {
  lobbyCode: string;
  playerIds: string[];
  czarIndex: number;
  chaosDeck: ChaosCard[];
  knowledgeDeck: KnowledgeCard[];
  knowledgeDiscard: KnowledgeCard[];
  chaosDiscard: ChaosCard[];
  characterDeck: KnowledgeCard[];
  characterDiscard: KnowledgeCard[];
  hands: Map<string, KnowledgeCard[]>;
  currentRound: InternalRound | null;
  scores: Map<string, number>;
  roundNumber: number;
  maxRounds: number;
  winMode: "rounds" | "points";
  targetPoints: number;
  gameOver: boolean;
  gameType: GameType;
  /** When true, only player IDs starting with "bot-" are eligible to be the
   *  card czar. Players just submit cards every round; bots judge. */
  botCzar: boolean;
}

const SUBMIT_TIME_MS = 60_000;
const JUDGE_TIME_MS = 60_000;
const CZAR_SETUP_TIME_MS = 30_000;

interface InternalRound {
  chaosCard: ChaosCard;
  czarId: string;
  phase: "czar_setup" | "submitting" | "judging" | "revealing";
  submissions: Map<string, KnowledgeCard[]>;
  winnerId: string | null;
  phaseDeadline: number;
  czarSetupCard: KnowledgeCard | null;
  spectatorVotes: Map<string, string>;
}

// ── Storage ──────────────────────────────────────────────────────────────────
// One JSON blob per lobby (cah:{code}) in Redis when REDIS_URL is set.
// Falls back to in-memory Map. Maps get serialised to arrays of entries.

const KEY = (code: string) => `cah:${code}`;
const local = new Map<string, InternalGameState>();

interface SerialisedGame {
  lobbyCode: string;
  playerIds: string[];
  czarIndex: number;
  chaosDeck: ChaosCard[];
  knowledgeDeck: KnowledgeCard[];
  knowledgeDiscard: KnowledgeCard[];
  chaosDiscard: ChaosCard[];
  characterDeck?: KnowledgeCard[];
  characterDiscard?: KnowledgeCard[];
  hands: [string, KnowledgeCard[]][];
  scores: [string, number][];
  roundNumber: number;
  maxRounds: number;
  winMode: "rounds" | "points";
  targetPoints: number;
  gameOver: boolean;
  gameType: GameType;
  botCzar?: boolean;
  currentRound: {
    chaosCard: ChaosCard;
    czarId: string;
    phase: InternalRound["phase"];
    submissions: [string, KnowledgeCard[]][];
    winnerId: string | null;
    phaseDeadline: number;
    czarSetupCard: KnowledgeCard | null;
    spectatorVotes: [string, string][];
  } | null;
}

function serialise(g: InternalGameState): SerialisedGame {
  return {
    lobbyCode: g.lobbyCode,
    playerIds: g.playerIds,
    czarIndex: g.czarIndex,
    chaosDeck: g.chaosDeck,
    knowledgeDeck: g.knowledgeDeck,
    knowledgeDiscard: g.knowledgeDiscard,
    chaosDiscard: g.chaosDiscard,
    characterDeck: g.characterDeck,
    characterDiscard: g.characterDiscard,
    hands: Array.from(g.hands.entries()),
    scores: Array.from(g.scores.entries()),
    roundNumber: g.roundNumber,
    maxRounds: g.maxRounds,
    winMode: g.winMode,
    targetPoints: g.targetPoints,
    gameOver: g.gameOver,
    gameType: g.gameType,
    botCzar: g.botCzar,
    currentRound: g.currentRound ? {
      chaosCard: g.currentRound.chaosCard,
      czarId: g.currentRound.czarId,
      phase: g.currentRound.phase,
      submissions: Array.from(g.currentRound.submissions.entries()),
      winnerId: g.currentRound.winnerId,
      phaseDeadline: g.currentRound.phaseDeadline,
      czarSetupCard: g.currentRound.czarSetupCard,
      spectatorVotes: Array.from(g.currentRound.spectatorVotes.entries()),
    } : null,
  };
}

function deserialise(s: SerialisedGame): InternalGameState {
  return {
    lobbyCode: s.lobbyCode,
    playerIds: s.playerIds,
    czarIndex: s.czarIndex,
    chaosDeck: s.chaosDeck,
    knowledgeDeck: s.knowledgeDeck,
    knowledgeDiscard: s.knowledgeDiscard,
    chaosDiscard: s.chaosDiscard,
    characterDeck: s.characterDeck || [],
    characterDiscard: s.characterDiscard || [],
    hands: new Map(s.hands),
    scores: new Map(s.scores),
    roundNumber: s.roundNumber,
    maxRounds: s.maxRounds,
    winMode: s.winMode,
    targetPoints: s.targetPoints,
    gameOver: s.gameOver,
    gameType: s.gameType,
    botCzar: s.botCzar || false,
    currentRound: s.currentRound ? {
      chaosCard: s.currentRound.chaosCard,
      czarId: s.currentRound.czarId,
      phase: s.currentRound.phase,
      submissions: new Map(s.currentRound.submissions),
      winnerId: s.currentRound.winnerId,
      phaseDeadline: s.currentRound.phaseDeadline,
      czarSetupCard: s.currentRound.czarSetupCard,
      spectatorVotes: new Map(s.currentRound.spectatorVotes || []),
    } : null,
  };
}

async function loadGame(code: string): Promise<InternalGameState | undefined> {
  if (redis) {
    const json = await redis.get(KEY(code));
    return json ? deserialise(JSON.parse(json)) : undefined;
  }
  return local.get(code);
}

async function saveGame(g: InternalGameState): Promise<void> {
  if (redis) {
    await redis.set(KEY(g.lobbyCode), JSON.stringify(serialise(g)));
    return;
  }
  local.set(g.lobbyCode, g);
}

async function deleteGame(code: string): Promise<void> {
  if (redis) {
    await redis.del(KEY(code));
    return;
  }
  local.delete(code);
}

async function getAllGames(): Promise<InternalGameState[]> {
  if (redis) {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", "cah:*", "COUNT", 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
    if (keys.length === 0) return [];
    const raws = await redis.mget(...keys);
    return raws.filter((r): r is string => !!r).map(r => deserialise(JSON.parse(r)));
  }
  return Array.from(local.values());
}

// ── Deck shuffling helpers ──

function reshuffleKnowledge(game: InternalGameState): void {
  if (game.knowledgeDiscard.length === 0) return;
  game.knowledgeDeck.push(...shuffled(game.knowledgeDiscard));
  game.knowledgeDiscard = [];
}

function reshuffleChaos(game: InternalGameState): void {
  if (game.chaosDiscard.length === 0) return;
  game.chaosDeck.push(...shuffled(game.chaosDiscard));
  game.chaosDiscard = [];
}

function drawKnowledge(game: InternalGameState): KnowledgeCard | null {
  if (game.knowledgeDeck.length === 0) reshuffleKnowledge(game);
  if (game.knowledgeDeck.length === 0) return null;
  return game.knowledgeDeck.pop()!;
}

function reshuffleCharacters(game: InternalGameState): void {
  if (game.characterDiscard.length === 0) return;
  game.characterDeck.push(...shuffled(game.characterDiscard));
  game.characterDiscard = [];
}

function drawCharacter(game: InternalGameState): KnowledgeCard | null {
  if (game.characterDeck.length === 0) reshuffleCharacters(game);
  if (game.characterDeck.length === 0) return null;
  return game.characterDeck.pop()!;
}

/** Superfight-aware discard: routes each played card to the right pool. */
function discardPlayed(game: InternalGameState, cards: KnowledgeCard[]): void {
  if (game.gameType === "superfight") {
    for (const c of cards) {
      if (c.role === "character") game.characterDiscard.push(c);
      else game.knowledgeDiscard.push(c);
    }
  } else {
    game.knowledgeDiscard.push(...cards);
  }
}

/** Superfight-aware draw replacement: matches the role of the played card. */
function drawReplacement(game: InternalGameState, played: KnowledgeCard): KnowledgeCard | null {
  if (game.gameType === "superfight" && played.role === "character") {
    return drawCharacter(game);
  }
  return drawKnowledge(game);
}

/**
 * Normalize a submission's card order. Superfight must always present as
 * [character, attribute] regardless of how the client/bot queued the picks —
 * this is what the judge and round-winner views rely on.
 */
function normalizeSubmissionOrder(game: InternalGameState, cards: KnowledgeCard[]): void {
  if (game.gameType !== "superfight") return;
  cards.sort((a, b) => {
    if (a.role === b.role) return 0;
    return a.role === "character" ? -1 : 1;
  });
}

/**
 * Pick hand indices to submit as a bot / force-submit.
 * Superfight must submit exactly one character + one attribute; everyone
 * else picks `pick` random cards.
 */
function pickSubmissionIndices(
  game: InternalGameState,
  hand: KnowledgeCard[],
  pick: number,
): number[] {
  if (game.gameType === "superfight") {
    const charIdx = hand.findIndex((c) => c.role === "character");
    const attrIdx = hand.findIndex((c) => c.role === "attribute");
    if (charIdx === -1 || attrIdx === -1) {
      // Degraded state (pool exhausted): fall back to any cards we have.
      return shuffled(hand.map((_, i) => i))
        .slice(0, Math.min(pick, hand.length))
        .sort((a, b) => b - a);
    }
    return [charIdx, attrIdx].sort((a, b) => b - a);
  }
  const count = Math.min(pick, hand.length);
  return shuffled(hand.map((_, i) => i)).slice(0, count).sort((a, b) => b - a);
}

function drawChaos(game: InternalGameState): ChaosCard | null {
  if (game.chaosDeck.length === 0) reshuffleChaos(game);
  if (game.chaosDeck.length === 0) return null;
  return game.chaosDeck.pop()!;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function createGame(
  lobbyCode: string,
  playerIds: string[],
  customChaos?: ChaosCard[],
  customKnowledge?: KnowledgeCard[],
  winCondition?: { mode: "rounds" | "points"; value: number },
  gameType?: GameType,
  options?: { botCzar?: boolean },
): Promise<void> {
  let chaosDeck: ChaosCard[];
  let knowledgeDeck: KnowledgeCard[];
  let characterDeck: KnowledgeCard[] = [];

  if (gameType === "superfight") {
    // Characters come from the deck's chaos (black) cards; attributes from its
    // knowledge (white) cards. Tag each so refills and submissions can route
    // to the right pool.
    characterDeck = shuffled(
      (customChaos || CHAOS_CARDS).map((c) => ({
        id: c.id,
        text: c.text,
        imageUrl: c.imageUrl,
        role: "character" as const,
      })),
    );
    knowledgeDeck = shuffled(
      (customKnowledge || KNOWLEDGE_CARDS).map((c) => ({ ...c, role: "attribute" as const })),
    );
    chaosDeck = [{ id: "sf-prompt", text: "Who would win in a fight?", pick: 2 }];
  } else {
    chaosDeck = shuffled(customChaos || CHAOS_CARDS);
    knowledgeDeck = shuffled(customKnowledge || KNOWLEDGE_CARDS);
  }

  const wc = winCondition || { mode: "rounds" as const, value: DEFAULT_MAX_ROUNDS };

  const hands = new Map<string, KnowledgeCard[]>();
  const scores = new Map<string, number>();
  for (const pid of playerIds) {
    if (gameType === "superfight") {
      const chars = characterDeck.splice(0, SF_CHARACTER_COUNT);
      const attrs = knowledgeDeck.splice(0, SF_ATTRIBUTE_COUNT);
      hands.set(pid, [...chars, ...attrs]);
    } else {
      hands.set(pid, knowledgeDeck.splice(0, HAND_SIZE));
    }
    scores.set(pid, 0);
  }

  const game: InternalGameState = {
    lobbyCode,
    playerIds,
    czarIndex: 0,
    chaosDeck,
    knowledgeDeck,
    knowledgeDiscard: [],
    chaosDiscard: [],
    characterDeck,
    characterDiscard: [],
    hands,
    currentRound: null,
    scores,
    roundNumber: 0,
    maxRounds: wc.mode === "rounds" ? wc.value : Infinity,
    winMode: wc.mode,
    targetPoints: wc.mode === "points" ? wc.value : Infinity,
    gameOver: false,
    gameType: gameType || "cah",
    botCzar: options?.botCzar || false,
  };

  await saveGame(game);
}

export async function startRound(lobbyCode: string): Promise<RoundState | null> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game || game.gameOver) return null;

  game.roundNumber++;
  if (game.roundNumber > game.maxRounds) {
    game.gameOver = true;
    await saveGame(game);
    return null;
  }

  if (game.currentRound) {
    if (game.gameType !== "superfight") {
      game.chaosDiscard.push(game.currentRound.chaosCard);
    }
  }

  // Top up every player's hand. Heals games that got into a bad state under
  // the old draw-then-push-to-discard bug (which could silently shrink hands).
  // Running every round is cheap and idempotent.
  // Superfight keeps 3 characters + 3 attributes per hand; everyone else
  // tops up a single pool to HAND_SIZE.
  for (const pid of game.playerIds) {
    const hand = game.hands.get(pid) || [];
    if (game.gameType === "superfight") {
      const charCount = hand.filter((c) => c.role === "character").length;
      const attrCount = hand.filter((c) => c.role === "attribute").length;
      for (let i = charCount; i < SF_CHARACTER_COUNT; i++) {
        const drawn = drawCharacter(game);
        if (!drawn) break;
        hand.push(drawn);
      }
      for (let i = attrCount; i < SF_ATTRIBUTE_COUNT; i++) {
        const drawn = drawKnowledge(game);
        if (!drawn) break;
        hand.push(drawn);
      }
    } else {
      while (hand.length < HAND_SIZE) {
        const drawn = drawKnowledge(game);
        if (!drawn) break; // deck+discard exhausted
        hand.push(drawn);
      }
    }
    game.hands.set(pid, hand);
  }

  // Bot-czar mode: only IDs starting with "bot-" are eligible to judge. If
  // every bot has been removed, end the game — the round can't proceed.
  let czarId: string;
  if (game.botCzar) {
    const botCandidates = game.playerIds.filter((id) => id.startsWith("bot-"));
    if (botCandidates.length === 0) {
      game.gameOver = true;
      await saveGame(game);
      return null;
    }
    czarId = botCandidates[game.czarIndex % botCandidates.length];
  } else {
    czarId = game.playerIds[game.czarIndex % game.playerIds.length];
  }

  let chaosCard: ChaosCard | null;
  if (game.gameType === "superfight") {
    chaosCard = { id: "sf-prompt", text: "Who would win in a fight?", pick: 2 };
  } else {
    chaosCard = drawChaos(game);
    if (!chaosCard) {
      game.gameOver = true;
      await saveGame(game);
      return null;
    }
  }

  // Auto-derive pick from the number of `___` blanks in the card text.
  // AI-generated and user-authored decks frequently stored pick:1 on
  // cards whose text has two blanks ("___ and ___ walk into a bar"),
  // which caused the UI to accept only 1 answer for a 2-answer prompt.
  // Meta cards (CHAOS RULE) embed `___` as a rule parameter, not a
  // player blank, so their stored pick stands. Superfight's synthetic
  // prompt is already pick:2.
  if (game.gameType !== "superfight" && !chaosCard.metaType) {
    const blanks = (chaosCard.text.match(/_{3,}/g) || []).length;
    if (blanks > 0) chaosCard.pick = blanks;
  }

  const isJH = game.gameType === "joking_hazard";
  const isBonus = isJH && !!chaosCard.bonus;

  let initialPhase: "czar_setup" | "submitting";
  if (isJH && !isBonus) {
    initialPhase = "czar_setup";
  } else {
    initialPhase = "submitting";
  }
  const phaseDeadline = Date.now() + (initialPhase === "czar_setup" ? CZAR_SETUP_TIME_MS : SUBMIT_TIME_MS);

  if (isBonus) {
    chaosCard.pick = 2;
  }

  game.currentRound = {
    chaosCard,
    czarId,
    phase: initialPhase,
    submissions: new Map(),
    winnerId: null,
    phaseDeadline,
    czarSetupCard: null,
    spectatorVotes: new Map(),
  };

  await saveGame(game);

  return {
    roundNumber: game.roundNumber,
    czarId,
    chaosCard,
    phase: initialPhase,
    submissions: [],
    winnerId: null,
    phaseDeadline,
    isBonus,
  };
  });
}

export async function getPlayerView(lobbyCode: string, playerId: string): Promise<PlayerGameView | null> {
  const game = await loadGame(lobbyCode);
  if (!game) return null;

  const hand = game.hands.get(playerId) || [];
  const round = game.currentRound;

  let roundState: RoundState | null = null;
  if (round) {
    roundState = {
      roundNumber: game.roundNumber,
      czarId: round.czarId,
      chaosCard: round.chaosCard,
      phase: round.phase,
      submissions:
        round.phase === "judging" || round.phase === "revealing"
          ? shuffled(Array.from(round.submissions.entries()).map(([pid, cards]) => ({
              playerId: pid,
              cards,
            })))
          : [],
      winnerId: round.winnerId,
      phaseDeadline: round.phaseDeadline,
      czarSetupCard: round.czarSetupCard || undefined,
      isBonus: round.chaosCard.bonus || undefined,
    };
  }

  return {
    hand,
    round: roundState,
    scores: Object.fromEntries(game.scores),
    roundNumber: game.roundNumber,
    maxRounds: game.maxRounds,
    gameOver: game.gameOver,
    hasSubmitted: round ? round.submissions.has(playerId) : false,
    gameType: game.gameType,
  };
}

// ── Czar Setup ───────────────────────────────────────────────────────────────

function czarSetupOn(
  game: InternalGameState,
  czarId: string,
  cardId: string
): { success: boolean; error?: string; czarSetupCard?: KnowledgeCard } {
  const round = game.currentRound;
  if (!round || round.phase !== "czar_setup") {
    return { success: false, error: "Not in czar setup phase" };
  }
  if (czarId !== round.czarId) {
    return { success: false, error: "Only the Judge can play the setup card" };
  }

  const hand = game.hands.get(czarId);
  if (!hand) return { success: false, error: "Player not in game" };

  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return { success: false, error: "Card not in your hand" };

  const playedCard = hand.splice(idx, 1)[0];
  const drawn = drawKnowledge(game);
  if (drawn) hand.push(drawn);

  round.czarSetupCard = playedCard;
  game.knowledgeDiscard.push(playedCard);
  round.phase = "submitting";
  round.phaseDeadline = Date.now() + SUBMIT_TIME_MS;

  return { success: true, czarSetupCard: playedCard };
}

export async function czarSetup(
  lobbyCode: string,
  czarId: string,
  cardId: string
): Promise<{ success: boolean; error?: string; czarSetupCard?: KnowledgeCard }> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };
  const result = czarSetupOn(game, czarId, cardId);
  if (result.success) await saveGame(game);
  return result;
  });
}

export async function botCzarSetup(lobbyCode: string, botCzarId: string): Promise<{ success: boolean; czarSetupCard?: KnowledgeCard }> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game?.currentRound || game.currentRound.phase !== "czar_setup") return { success: false };
  if (game.currentRound.czarId !== botCzarId) return { success: false };

  const hand = game.hands.get(botCzarId);
  if (!hand || hand.length === 0) return { success: false };

  const randomIdx = Math.floor(Math.random() * hand.length);
  const result = czarSetupOn(game, botCzarId, hand[randomIdx].id);
  if (result.success) await saveGame(game);
  return result;
  });
}

export async function forceCzarSetup(lobbyCode: string): Promise<KnowledgeCard | null> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game?.currentRound || game.currentRound.phase !== "czar_setup") return null;

  const czarId = game.currentRound.czarId;
  const hand = game.hands.get(czarId);
  if (!hand || hand.length === 0) return null;

  const randomIdx = Math.floor(Math.random() * hand.length);
  const result = czarSetupOn(game, czarId, hand[randomIdx].id);
  if (result.success) await saveGame(game);
  return result.czarSetupCard || null;
  });
}

export async function getGameType(lobbyCode: string): Promise<GameType | undefined> {
  return (await loadGame(lobbyCode))?.gameType;
}

export async function getCurrentPhase(lobbyCode: string): Promise<string | undefined> {
  return (await loadGame(lobbyCode))?.currentRound?.phase;
}

// ── Submit ───────────────────────────────────────────────────────────────────

function submitCardsOn(
  game: InternalGameState,
  playerId: string,
  cardIds: string[]
): { success: boolean; allSubmitted: boolean; error?: string } {
  const round = game.currentRound;
  if (!round || round.phase !== "submitting") {
    return { success: false, allSubmitted: false, error: "Not in submission phase" };
  }

  if (playerId === round.czarId) {
    return { success: false, allSubmitted: false, error: "The Czar doesn't submit cards" };
  }

  if (round.submissions.has(playerId)) {
    return { success: false, allSubmitted: false, error: "Already submitted" };
  }

  const hand = game.hands.get(playerId);
  if (!hand) return { success: false, allSubmitted: false, error: "Player not in game" };

  const requiredCards = Math.min(round.chaosCard.pick, hand.length);
  if (cardIds.length !== requiredCards) {
    return { success: false, allSubmitted: false, error: `Must submit exactly ${requiredCards} card(s)` };
  }

  const playedCards: KnowledgeCard[] = [];
  for (const cid of cardIds) {
    const idx = hand.findIndex((c) => c.id === cid);
    if (idx === -1) {
      return { success: false, allSubmitted: false, error: "Card not in your hand" };
    }
    playedCards.push(hand.splice(idx, 1)[0]);
  }

  // Superfight must be exactly one character + one attribute. If the caller
  // sent two of the same role, put the cards back and reject.
  if (game.gameType === "superfight") {
    const chars = playedCards.filter((c) => c.role === "character").length;
    const attrs = playedCards.filter((c) => c.role === "attribute").length;
    if (chars !== 1 || attrs !== 1) {
      hand.push(...playedCards);
      return {
        success: false,
        allSubmitted: false,
        error: "Pick 1 character + 1 attribute",
      };
    }
  }

  // Push to discard BEFORE drawing so the reshuffle inside drawKnowledge
  // can see these cards when the main deck is empty. Previously the order
  // was draw-then-push, which silently shrank hands when deck+discard were
  // both empty mid-round (tiny decks, or after many force-submits).
  normalizeSubmissionOrder(game, playedCards);
  round.submissions.set(playerId, playedCards);
  discardPlayed(game, playedCards);

  for (const played of playedCards) {
    const drawn = drawReplacement(game, played);
    if (drawn) hand.push(drawn);
  }

  const expectedCount = game.playerIds.filter((id) => id !== round.czarId).length;
  const allSubmitted = round.submissions.size >= expectedCount;

  if (allSubmitted) {
    round.phase = "judging";
    round.phaseDeadline = Date.now() + JUDGE_TIME_MS;
  }

  return { success: true, allSubmitted };
}

export async function submitCards(
  lobbyCode: string,
  playerId: string,
  cardIds: string[]
): Promise<{ success: boolean; allSubmitted: boolean; error?: string }> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, allSubmitted: false, error: "Game not found" };
  const result = submitCardsOn(game, playerId, cardIds);
  if (result.success) await saveGame(game);
  return result;
  });
}

export async function getJudgingData(lobbyCode: string): Promise<{
  submissions: Submission[];
  chaosCard: ChaosCard;
} | null> {
  const game = await loadGame(lobbyCode);
  if (!game?.currentRound || game.currentRound.phase !== "judging") return null;

  const round = game.currentRound;
  const submissions = shuffled(
    Array.from(round.submissions.entries()).map(([playerId, cards]) => ({
      playerId,
      cards,
    }))
  );

  return { submissions, chaosCard: round.chaosCard };
}

export function resolveMetaTargets(
  target: MetaTarget,
  winnerId: string,
  czarId: string,
  playerIds: string[]
): string[] {
  switch (target) {
    case "winner": return [winnerId];
    case "czar": return [czarId];
    case "all": return playerIds;
    case "all_others": return playerIds.filter((id) => id !== winnerId);
    case "loser": {
      return playerIds.filter((id) => id !== winnerId && id !== czarId);
    }
    default: return [];
  }
}

export async function resetPlayerHand(lobbyCode: string, playerId: string): Promise<KnowledgeCard[]> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return [];

  const oldHand = game.hands.get(playerId);
  if (oldHand) discardPlayed(game, oldHand);

  const newHand: KnowledgeCard[] = [];
  if (game.gameType === "superfight") {
    for (let i = 0; i < SF_CHARACTER_COUNT; i++) {
      const drawn = drawCharacter(game);
      if (drawn) newHand.push(drawn);
    }
    for (let i = 0; i < SF_ATTRIBUTE_COUNT; i++) {
      const drawn = drawKnowledge(game);
      if (drawn) newHand.push(drawn);
    }
  } else {
    for (let i = 0; i < HAND_SIZE; i++) {
      const drawn = drawKnowledge(game);
      if (drawn) newHand.push(drawn);
    }
  }
  game.hands.set(playerId, newHand);
  await saveGame(game);
  return newHand;
  });
}

// ── Pick Winner ──────────────────────────────────────────────────────────────

function pickWinnerOn(
  game: InternalGameState,
  czarId: string,
  winnerId: string
): {
  success: boolean;
  error?: string;
  metaEffect?: {
    effect: MetaEffect;
    winnerId: string;
    czarId: string;
    playerIds: string[];
  };
} {
  const round = game.currentRound;
  if (!round || round.phase !== "judging") {
    return { success: false, error: "Not in judging phase" };
  }

  if (czarId !== round.czarId) {
    return { success: false, error: "Only the Czar can pick the winner" };
  }

  if (!round.submissions.has(winnerId)) {
    return { success: false, error: "Invalid winner" };
  }

  round.winnerId = winnerId;
  round.phase = "revealing";
  const pointsAwarded = (game.gameType === "joking_hazard" && round.chaosCard.bonus) ? 2 : 1;
  const newScore = (game.scores.get(winnerId) || 0) + pointsAwarded;
  game.scores.set(winnerId, newScore);

  if (game.winMode === "points" && newScore >= game.targetPoints) {
    game.gameOver = true;
  }

  const metaEffect = round.chaosCard.metaEffect;
  if (metaEffect) {
    const targets = resolveMetaTargets(metaEffect.target, winnerId, czarId, game.playerIds);

    if (metaEffect.type === "score_add" && metaEffect.value) {
      for (const pid of targets) {
        game.scores.set(pid, (game.scores.get(pid) || 0) + metaEffect.value!);
      }
    } else if (metaEffect.type === "score_subtract" && metaEffect.value) {
      for (const pid of targets) {
        const current = game.scores.get(pid) || 0;
        game.scores.set(pid, Math.max(0, current - metaEffect.value!));
      }
    }

    return {
      success: true,
      metaEffect: {
        effect: metaEffect,
        winnerId,
        czarId,
        playerIds: game.playerIds,
      },
    };
  }

  return { success: true };
}

export async function pickWinner(
  lobbyCode: string,
  czarId: string,
  winnerId: string
): Promise<{
  success: boolean;
  error?: string;
  metaEffect?: {
    effect: MetaEffect;
    winnerId: string;
    czarId: string;
    playerIds: string[];
  };
}> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };
  const result = pickWinnerOn(game, czarId, winnerId);
  if (result.success) await saveGame(game);
  return result;
  });
}

export async function getWinnerCards(lobbyCode: string): Promise<KnowledgeCard[] | null> {
  const game = await loadGame(lobbyCode);
  if (!game?.currentRound) return null;
  const winnerId = game.currentRound.winnerId;
  if (!winnerId) return null;
  return game.currentRound.submissions.get(winnerId) || null;
}

export async function advanceRound(lobbyCode: string): Promise<void> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return;
  game.czarIndex++;
  game.currentRound = null;
  await saveGame(game);
  });
}

export async function getScores(lobbyCode: string): Promise<Record<string, number> | null> {
  const game = await loadGame(lobbyCode);
  if (!game) return null;
  return Object.fromEntries(game.scores);
}

export async function isGameOver(lobbyCode: string): Promise<boolean> {
  const game = await loadGame(lobbyCode);
  if (!game) return true;
  return game.gameOver || game.roundNumber >= game.maxRounds;
}

export async function getWinInfo(lobbyCode: string): Promise<{ mode: "rounds" | "points"; value: number } | null> {
  const game = await loadGame(lobbyCode);
  if (!game) return null;
  return { mode: game.winMode, value: game.winMode === "points" ? game.targetPoints : game.maxRounds };
}

export async function endGame(lobbyCode: string): Promise<void> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (game) {
    game.gameOver = true;
    await saveGame(game);
  }
  });
}

export async function cleanupGame(lobbyCode: string): Promise<void> {
  return withGameLock("cah", lobbyCode, async () => {
    await deleteGame(lobbyCode);
  });
}

export async function getPlayerIds(lobbyCode: string): Promise<string[]> {
  return (await loadGame(lobbyCode))?.playerIds || [];
}

export async function getCzarId(lobbyCode: string): Promise<string | undefined> {
  return (await loadGame(lobbyCode))?.currentRound?.czarId;
}

export async function addPlayerToGame(lobbyCode: string, playerId: string): Promise<boolean> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game || game.gameOver) return false;

  if (game.playerIds.includes(playerId)) return true;

  game.playerIds.push(playerId);
  game.scores.set(playerId, 0);

  const hand: KnowledgeCard[] = [];
  if (game.gameType === "superfight") {
    for (let i = 0; i < SF_CHARACTER_COUNT; i++) {
      const drawn = drawCharacter(game);
      if (drawn) hand.push(drawn);
    }
    for (let i = 0; i < SF_ATTRIBUTE_COUNT; i++) {
      const drawn = drawKnowledge(game);
      if (drawn) hand.push(drawn);
    }
  } else {
    for (let i = 0; i < HAND_SIZE; i++) {
      const drawn = drawKnowledge(game);
      if (drawn) hand.push(drawn);
    }
  }
  game.hands.set(playerId, hand);

  await saveGame(game);
  return true;
  });
}

export async function removePlayerFromGame(lobbyCode: string, playerId: string): Promise<void> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return;

  const hand = game.hands.get(playerId);
  if (hand) discardPlayed(game, hand);

  game.playerIds = game.playerIds.filter(id => id !== playerId);
  game.hands.delete(playerId);
  game.scores.delete(playerId);

  if (game.currentRound) {
    game.currentRound.submissions.delete(playerId);

    // If the leaver was the current czar, the round can't proceed — rotate
    // the czar and end the round. Next "next-round" cycle starts fresh.
    // Without this, round.czarId dangles at a removed player and the client
    // falls through to the "???" name fallback.
    if (game.currentRound.czarId === playerId) {
      game.czarIndex++;
      game.currentRound = null;
    }
  }

  await saveGame(game);
  });
}

export async function botSubmitCards(lobbyCode: string, botId: string): Promise<{ success: boolean; allSubmitted: boolean }> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, allSubmitted: false };

  const round = game.currentRound;
  if (!round || round.phase !== "submitting") return { success: false, allSubmitted: false };
  if (botId === round.czarId) return { success: false, allSubmitted: false };
  if (round.submissions.has(botId)) return { success: false, allSubmitted: false };

  const hand = game.hands.get(botId);
  if (!hand || hand.length === 0) return { success: false, allSubmitted: false };

  const indices = pickSubmissionIndices(game, hand, round.chaosCard.pick);
  if (indices.length === 0) return { success: false, allSubmitted: false };

  const playedCards: KnowledgeCard[] = [];
  for (const idx of indices) {
    playedCards.push(hand.splice(idx, 1)[0]);
  }

  // Discard-before-draw so the reshuffle can recycle these cards when the
  // main deck is empty. See submitCardsOn for the full note.
  normalizeSubmissionOrder(game, playedCards);
  round.submissions.set(botId, playedCards);
  discardPlayed(game, playedCards);

  for (const played of playedCards) {
    const drawn = drawReplacement(game, played);
    if (drawn) hand.push(drawn);
  }

  const expectedCount = game.playerIds.filter(id => id !== round.czarId).length;
  const allSubmitted = round.submissions.size >= expectedCount;
  if (allSubmitted) {
    round.phase = "judging";
    round.phaseDeadline = Date.now() + JUDGE_TIME_MS;
  }

  await saveGame(game);
  return { success: true, allSubmitted };
  });
}

export async function forceSubmitForMissing(lobbyCode: string): Promise<string[]> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game?.currentRound || game.currentRound.phase !== "submitting") return [];

  const round = game.currentRound;
  const missing = game.playerIds.filter(id => id !== round.czarId && !round.submissions.has(id));

  for (const pid of missing) {
    const hand = game.hands.get(pid);
    if (!hand || hand.length === 0) continue;

    const indices = pickSubmissionIndices(game, hand, round.chaosCard.pick);
    if (indices.length === 0) continue;

    const playedCards: KnowledgeCard[] = [];
    for (const idx of indices) {
      playedCards.push(hand.splice(idx, 1)[0]);
    }

    // Force-submitted cards were previously never pushed to discard — a
    // permanent card leak. Push them first so the pool stays conserved
    // and the draw below can recycle them if needed.
    normalizeSubmissionOrder(game, playedCards);
    round.submissions.set(pid, playedCards);
    discardPlayed(game, playedCards);

    for (const played of playedCards) {
      const drawn = drawReplacement(game, played);
      if (drawn) hand.push(drawn);
    }
  }

  round.phase = "judging";
  round.phaseDeadline = Date.now() + JUDGE_TIME_MS;
  await saveGame(game);
  return missing;
  });
}

export async function getPhaseDeadline(lobbyCode: string): Promise<number | null> {
  const game = await loadGame(lobbyCode);
  return game?.currentRound?.phaseDeadline ?? null;
}

export async function botPickWinner(lobbyCode: string, botCzarId: string): Promise<{ winnerId: string | null; metaEffect?: any }> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game?.currentRound || game.currentRound.phase !== "judging") return { winnerId: null };
  if (game.currentRound.czarId !== botCzarId) return { winnerId: null };

  const submitters = Array.from(game.currentRound.submissions.keys());
  if (submitters.length === 0) return { winnerId: null };

  const winnerId = submitters[Math.floor(Math.random() * submitters.length)];
  const result = pickWinnerOn(game, botCzarId, winnerId);

  if (result.success) {
    await saveGame(game);
    return { winnerId, metaEffect: result.metaEffect };
  }
  return { winnerId: null };
  });
}

export async function spectatorVote(
  lobbyCode: string,
  spectatorId: string,
  votedForId: string
): Promise<{ success: boolean; error?: string; allPlayersVoted?: boolean }> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };

  const round = game.currentRound;
  if (!round || round.phase !== "judging") {
    return { success: false, error: "Not in judging phase" };
  }

  // The bot czar never votes (it's "judging" cosmetically).
  if (spectatorId === round.czarId) {
    return { success: false, error: "Czar cannot vote" };
  }

  if (!round.submissions.has(votedForId)) {
    return { success: false, error: "Invalid submission" };
  }

  if (round.spectatorVotes.has(spectatorId)) {
    return { success: false, error: "Already voted" };
  }

  round.spectatorVotes.set(spectatorId, votedForId);
  await saveGame(game);

  // True when every non-czar in-game player has cast a vote. Used by the
  // bot-czar flow to tally early instead of waiting for the judging timer.
  // Spectators aren't tracked in the game module, so we ignore them here —
  // they still vote during the window, just don't trigger the early tally.
  const expectedVoters = game.playerIds.filter((id) => id !== round.czarId);
  const allPlayersVoted = expectedVoters.every((id) => round.spectatorVotes.has(id));

  return { success: true, allPlayersVoted };
  });
}

/** Tally bot-czar votes and pick the winning submission (random tie-break,
 *  random submitter if no votes at all). Applies scoring via pickWinnerOn. */
export async function tallyVotesAndPick(lobbyCode: string): Promise<{
  winnerId: string | null;
  metaEffect?: any;
  votes?: Record<string, number>;
}> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game?.currentRound || game.currentRound.phase !== "judging") return { winnerId: null };
  if (!game.botCzar) return { winnerId: null };

  const round = game.currentRound;
  const submitters = Array.from(round.submissions.keys());
  if (submitters.length === 0) return { winnerId: null };

  // Tally only votes that point at a real submission (defensive — votes for
  // since-removed players get filtered out).
  const tally = new Map<string, number>();
  for (const votedFor of round.spectatorVotes.values()) {
    if (round.submissions.has(votedFor)) {
      tally.set(votedFor, (tally.get(votedFor) || 0) + 1);
    }
  }

  let winnerId: string;
  if (tally.size === 0) {
    // No usable votes — pick a random submitter so the round still resolves.
    winnerId = submitters[Math.floor(Math.random() * submitters.length)];
  } else {
    const max = Math.max(...tally.values());
    const tied = Array.from(tally.entries()).filter(([, n]) => n === max).map(([id]) => id);
    winnerId = tied[Math.floor(Math.random() * tied.length)];
  }

  const result = pickWinnerOn(game, round.czarId, winnerId);
  if (!result.success) return { winnerId: null };
  await saveGame(game);
  return {
    winnerId,
    metaEffect: result.metaEffect,
    votes: Object.fromEntries(tally),
  };
  });
}

/** Read-only check used by handlers to decide between bot-czar judging and
 *  vote-driven judging. */
export async function isBotCzarMode(lobbyCode: string): Promise<boolean> {
  return (await loadGame(lobbyCode))?.botCzar || false;
}

export async function getAudiencePick(lobbyCode: string): Promise<string | null> {
  const game = await loadGame(lobbyCode);
  if (!game?.currentRound) return null;

  const votes = game.currentRound.spectatorVotes;
  if (votes.size === 0) return null;

  const tally = new Map<string, number>();
  for (const votedFor of votes.values()) {
    tally.set(votedFor, (tally.get(votedFor) || 0) + 1);
  }

  let maxVotes = 0;
  let audiencePick: string | null = null;
  for (const [playerId, count] of tally) {
    if (count > maxVotes) {
      maxVotes = count;
      audiencePick = playerId;
    }
  }

  return audiencePick;
}

// ── Snapshot / Restore ───────────────────────────────────────────────────────

export async function exportGames(): Promise<any[]> {
  const games = await getAllGames();
  return games.map(g => serialise(g));
}

const ABANDONED_GAME_STALENESS_MS = 60 * 60 * 1000; // 1h past phaseDeadline → zombie
const POST_RESTORE_GRACE_MS = 3 * 60 * 1000; // extra time on top of the normal phase window after a deploy/restore

export async function restoreGames(snapshots: any[]): Promise<void> {
  for (const s of snapshots) {
    const game = deserialise(s as SerialisedGame);
    // Skip zombie games — rounds whose phaseDeadline was already an hour
    // in the past at restore time mean nobody's been playing. Resurrecting
    // them each deploy just keeps re-firing their czar-timeout and polluting
    // logs without a user ever seeing the result.
    if (game.currentRound && Date.now() - game.currentRound.phaseDeadline > ABANDONED_GAME_STALENESS_MS) {
      continue;
    }
    // Phase timers don't survive; give the new round a fresh deadline from
    // now so timers restart cleanly on the new instance. Add a 3-minute grace
    // period so users who were mid-round when the deploy hit get enough time
    // to reconnect, re-read cards, and click — instead of having the clock
    // snap to the normal phase window the moment the server comes back.
    if (game.currentRound) {
      const baseWindow = game.currentRound.phase === "judging" ? JUDGE_TIME_MS
        : game.currentRound.phase === "czar_setup" ? CZAR_SETUP_TIME_MS
        : SUBMIT_TIME_MS;
      game.currentRound.phaseDeadline = Date.now() + baseWindow + POST_RESTORE_GRACE_MS;
    }
    await saveGame(game);
  }
}

export async function remapGamePlayer(
  lobbyCode: string,
  oldPlayerId: string,
  newPlayerId: string
): Promise<void> {
  return withGameLock("cah", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return;

  const idx = game.playerIds.indexOf(oldPlayerId);
  if (idx !== -1) {
    game.playerIds[idx] = newPlayerId;
  }

  const hand = game.hands.get(oldPlayerId);
  if (hand) {
    game.hands.delete(oldPlayerId);
    game.hands.set(newPlayerId, hand);
  }

  if (game.scores.has(oldPlayerId)) {
    const score = game.scores.get(oldPlayerId)!;
    game.scores.delete(oldPlayerId);
    game.scores.set(newPlayerId, score);
  }

  const round = game.currentRound;
  if (round) {
    if (round.czarId === oldPlayerId) {
      round.czarId = newPlayerId;
    }

    if (round.submissions.has(oldPlayerId)) {
      const cards = round.submissions.get(oldPlayerId)!;
      round.submissions.delete(oldPlayerId);
      round.submissions.set(newPlayerId, cards);
    }

    if (round.winnerId === oldPlayerId) {
      round.winnerId = newPlayerId;
    }
  }

  await saveGame(game);
  });
}
