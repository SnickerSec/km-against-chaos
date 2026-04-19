// Blackjack game engine. State lives in Redis (one JSON blob per lobby,
// keyed blackjack:{code}) when REDIS_URL is set, otherwise in a local Map.
// Public API is async throughout so every replica reads the same state.

import { redis, withGameLock } from "./redis.js";

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

// ── Public API ───────────────────────────────────────────────────────────────

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
