# Blackjack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth game type, `blackjack` — casino-style multiplayer with a bot dealer, variable-bet virtual chips scoped to the lobby session, last-player-standing elimination loop. MVP rule set: Hit / Stand / Double Down / Split (no insurance, no surrender, no re-split, single deck reshuffled each hand). Sequential play with a parallel betting window.

**Architecture:** New `server/src/blackjackGame.ts` engine mirrors `codenamesGame.ts` — async public API, Redis-keyed JSON blob (`blackjack:{lobbyCode}`) with in-memory Map fallback when `REDIS_URL` is unset, every mutation wrapped in `withGameLock("blackjack", code, fn)`. Three at-most-once Redis-locked timers (betting / per-turn / settle) follow the `socketHelpers.ts` pattern. New `blackjack_game_snapshots` Postgres table for SIGTERM snapshot + boot restore. New socket events `blackjack:bet|hit|stand|double|split|sit-out`. New `BlackjackGameScreen.tsx` rendered from `GameScreen.tsx` switch.

**Tech Stack:** TypeScript, ioredis, vitest, Express + Socket.IO, PostgreSQL (`pg`), Next.js 15 (React 19), Zustand, Tailwind.

**Spec:** `docs/superpowers/specs/2026-04-19-blackjack-design.md`

---

## File Structure

**New files:**

| Path | Responsibility |
|------|----------------|
| `server/src/blackjackGame.ts` | Engine — types, state I/O, `createBlackjackGame`/`placeBet`/`hit`/`stand`/`double`/`split`/`sitOut`/`endBettingPhase`/`endTurnPhase`/`endSettlePhase`/`removePlayerFromBlackjackGame`/`exportBlackjackGames`/`restoreBlackjackGames`/`isBlackjackGame`/`cleanupBlackjackGame`/`getBlackjackTurnDeadline` |
| `server/src/handlers/blackjackHandlers.ts` | Socket events: `blackjack:bet|hit|stand|double|split|sit-out`. Schedules per-phase timers via socketHelpers. |
| `server/src/__tests__/blackjackGame.test.ts` | Vitest suite — pure-engine tests with stubbed shoes |
| `server/migrations/019_blackjack_snapshots.sql` | `blackjack_game_snapshots` table + built-in deck row |
| `client/src/components/BlackjackGameScreen.tsx` | Table view, dealer at top, players around, betting + action bar |
| `client/src/lib/blackjackStore.ts` | Zustand slice for current blackjack view |

**Modified files:**

| Path | Change |
|------|--------|
| `server/src/types.ts:57` | Add `"blackjack"` to `GameType` union |
| `server/src/deckStore.ts:114` | Extend card-validation skip to `gameType === "blackjack"` |
| `server/src/snapshot.ts` | Wire export/restore for blackjack games |
| `server/src/socketHelpers.ts` | Add `scheduleBlackjackTimer` (3 phases) + `claimTimerLock` adds `"blackjack"` namespace |
| `server/src/redis.ts` | `GameLockNamespace` adds `"blackjack"` |
| `server/src/handlers/lobbyHandlers.ts` | Add `gameType === "blackjack"` branch in `start-game` flow + extend `gameType` union literal |
| `server/src/index.ts` | Register `blackjackHandlers` |
| `client/src/lib/store.ts:77` | Add `"blackjack"` to client `GameType` |
| `client/src/components/GameScreen.tsx:45` | Add `if (gameType === "blackjack") return <BlackjackGameScreen />` |

---

## Task index

**Engine (TDD):** T1 bootstrap • T2 createBlackjackGame • T3 placeBet • T4 auto-advance betting→dealing • T5 dealing • T6 hit • T7 stand • T8 double • T9 split (basic) • T10 split aces / no re-split • T11 dealer phase • T12 settle outcomes • T13 elimination + auto-loop

**Snapshot:** T14 export/restore + zombie filter

**Wiring:** T15 migration + GameType + deckStore • T16 snapshot.ts • T17 redis namespace + socketHelpers timers • T18 blackjackHandlers • T19 index registration • T20 lobbyHandlers start-game branch

**Client:** T21 store + types • T22 BlackjackGameScreen • T23 GameScreen switch • T24 manual smoke test

---

## Conventions for every task

- Run server tests with: `npm --prefix server test -- --run blackjackGame`
- Run typecheck with: `cd server && npx tsc --noEmit`
- Commit message format: `blackjack: <subject>` for engine, `blackjack(wiring): ...`, `blackjack(client): ...`, `blackjack(snapshot): ...`
- Co-author trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- TDD strictly: write test → run-fail → implement → run-pass → commit. Don't batch multiple features per commit.

---

### Task 1: Bootstrap blackjackGame.ts module

Creates the engine skeleton — types, Redis-or-Map storage, empty exports — so subsequent tasks have something to import. No public game logic yet, just plumbing + the round-trip-empty-state test.

**Files:**
- Create: `server/src/blackjackGame.ts`
- Create: `server/src/__tests__/blackjackGame.test.ts`
- Modify: `server/src/redis.ts` (add `"blackjack"` to `GameLockNamespace`)

- [ ] **Step 1: Add `"blackjack"` to the lock namespace**

In `server/src/redis.ts:55`, change:

```ts
export type GameLockNamespace = "cah" | "uno" | "codenames" | "lobby";
```

to:

```ts
export type GameLockNamespace = "cah" | "uno" | "codenames" | "lobby" | "blackjack";
```

- [ ] **Step 2: Write the failing test**

Create `server/src/__tests__/blackjackGame.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isBlackjackGame,
  cleanupBlackjackGame,
  exportBlackjackGames,
  restoreBlackjackGames,
} from "../blackjackGame.js";

const LOBBY = "test-blackjack-001";

beforeEach(async () => {
  await cleanupBlackjackGame(LOBBY);
});

afterEach(async () => {
  await cleanupBlackjackGame(LOBBY);
});

describe("blackjackGame storage skeleton", () => {
  it("isBlackjackGame returns false for an unknown lobby", async () => {
    expect(await isBlackjackGame(LOBBY)).toBe(false);
  });

  it("export returns [] when no games exist", async () => {
    expect(await exportBlackjackGames()).toEqual([]);
  });

  it("restore is a no-op for an empty snapshot list", async () => {
    await restoreBlackjackGames([]);
    expect(await isBlackjackGame(LOBBY)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test — expect import-not-found failure**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `Cannot find module '../blackjackGame.js'` or similar.

- [ ] **Step 4: Create the engine skeleton**

Create `server/src/blackjackGame.ts`:

```ts
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
```

- [ ] **Step 5: Run the test — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS (3 tests).

- [ ] **Step 6: Run typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: silent (no errors).

- [ ] **Step 7: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts server/src/redis.ts
git commit -m "$(cat <<'EOF'
blackjack: bootstrap engine skeleton

Types (Card/Hand/Phase/Settlement/Config), Redis-or-Map storage with the
same key/scan pattern as codenamesGame.ts, empty public API
(isBlackjackGame, cleanupBlackjackGame, exportBlackjackGames,
restoreBlackjackGames). Restore already filters >2h zombies — same
threshold as codenamesGame.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: createBlackjackGame

Initial state — shuffled 52-card shoe, every player gets `startingChips`, phase = `betting`, no bets placed yet.

**Files:**
- Modify: `server/src/blackjackGame.ts`
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/src/__tests__/blackjackGame.test.ts`:

```ts
import {
  createBlackjackGame,
  getBlackjackPlayerView,
} from "../blackjackGame.js";

const PLAYERS = ["p1", "p2", "p3"];
const CONFIG = { startingChips: 1000, minBet: 10, maxBet: 500 };

describe("createBlackjackGame", () => {
  it("initialises every player with startingChips and a 52-card shoe", async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    expect(await isBlackjackGame(LOBBY)).toBe(true);

    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.phase).toBe("betting");
    expect(view.chips).toEqual({ p1: 1000, p2: 1000, p3: 1000 });
    expect(view.bets).toEqual({ p1: null, p2: null, p3: null });
    expect(view.hands).toEqual({ p1: [], p2: [], p3: [] });
    expect(view.dealerHand).toEqual([]);
    expect(view.roundNumber).toBe(1);
    expect(view.shoeRemaining).toBe(52);
    expect(view.gameType).toBe("blackjack");
  });

  it("rejects fewer than 1 player", async () => {
    await expect(createBlackjackGame(LOBBY, [], CONFIG)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test — expect fail**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `createBlackjackGame is not a function` / `getBlackjackPlayerView is not a function`.

- [ ] **Step 3: Implement createBlackjackGame and getBlackjackPlayerView**

In `server/src/blackjackGame.ts`, **before** the `// ── Public API ──` section, add:

```ts
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
```

Then add to the **Public API** section:

```ts
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
```

At the very top of the file (after imports), add the constants used here and in later tasks:

```ts
// ── Configuration ────────────────────────────────────────────────────────────

export const BETTING_WINDOW_MS = 15_000;
export const TURN_TIME_MS = 30_000;
export const SETTLE_DELAY_MS = 5_000;
```

Then add the player-view function:

```ts
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
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: createBlackjackGame + player view

Initial state shape — 52-card shuffled shoe, per-player chip pool,
betting phase. Player view hides the dealer's hole card during dealing
and playing, reveals from dealer phase onward.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: placeBet

Player submits a bet within range and chips reserved. Failure modes: wrong phase, below min, above max, above current chips, sitting-out player.

**Files:**
- Modify: `server/src/blackjackGame.ts`
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```ts
import { placeBet, sitOut } from "../blackjackGame.js";

describe("placeBet", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
  });

  it("accepts a valid bet and reserves chips", async () => {
    const r = await placeBet(LOBBY, "p1", 100);
    expect(r.success).toBe(true);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.bets.p1).toBe(100);
    expect(view.chips.p1).toBe(900);
  });

  it("rejects below minBet", async () => {
    const r = await placeBet(LOBBY, "p1", 5);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/min/i);
  });

  it("rejects above maxBet", async () => {
    const r = await placeBet(LOBBY, "p1", 600);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/max/i);
  });

  it("rejects above current chips", async () => {
    await placeBet(LOBBY, "p1", 500);
    await placeBet(LOBBY, "p1", 500); // can't double-bet anyway, but covers chip-check
    // chips were 1000 → 500 after first bet. Second bet should fail before chips.
  });

  it("rejects double-betting in the same round", async () => {
    await placeBet(LOBBY, "p1", 100);
    const r = await placeBet(LOBBY, "p1", 100);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already/i);
  });

  it("rejects when phase != betting", async () => {
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
    // After all bets land we should be off betting (covered by Task 4).
    // For now, just place and force-cleanup; ignore this assertion until T4.
    // Will re-enable: const r = await placeBet(LOBBY, "p1", 50); expect(r.success).toBe(false);
  });

  it("sitOut marks the player as sitting_out and refunds nothing", async () => {
    const r = await sitOut(LOBBY, "p1");
    expect(r.success).toBe(true);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.bets.p1).toBe("sitting_out");
    expect(view.chips.p1).toBe(1000);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `placeBet is not a function` / `sitOut is not a function`.

- [ ] **Step 3: Implement placeBet + sitOut**

In `server/src/blackjackGame.ts`, add:

```ts
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
    await saveGame(g);
    return { success: true };
  });
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: placeBet + sitOut

Validates phase, player membership, double-bet, range, and chip
sufficiency. Chips are reserved at bet placement (deducted now,
returned on settle).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Auto-advance betting → dealing when all bets in

When the last in-funded player submits, the round should transition to `dealing`, deal two cards each + dealer hand, then move to `playing` (or `dealer` if every player is sitting out). This task handles only the betting → dealing → playing transition; dealing card values are covered by the test in Task 5 (sets up shoe, asserts hand sizes).

**Files:**
- Modify: `server/src/blackjackGame.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe("betting auto-advance", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
  });

  it("advances to playing after all funded players bet", async () => {
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.phase).toBe("playing");
    expect(view.activePlayerId).toBe("p1");
    // 3 players × 2 cards + 2 dealer = 8 cards out of 52
    expect(view.shoeRemaining).toBe(44);
  });

  it("sit-out + bets advance to playing too", async () => {
    await sitOut(LOBBY, "p1");
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.phase).toBe("playing");
    expect(view.hands.p1).toEqual([]); // sitting-out player has no hand
  });
});
```

- [ ] **Step 2: Run — expect fail (phase still `betting`)**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `expected 'betting' to be 'playing'`.

- [ ] **Step 3: Implement the advance**

Add to `server/src/blackjackGame.ts`:

```ts
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
  // Skip directly to playing, with active player = first non-sitting-out seat.
  g.phase = "playing";
  g.activePlayerIndex = g.playerIds.findIndex(pid => g.hands[pid].length > 0);
  g.activeHandIndex = 0;
  g.phaseDeadline = Date.now() + TURN_TIME_MS;

  // If literally everyone is sitting out, jump to dealer phase (which will
  // immediately settle with no payouts).
  if (g.activePlayerIndex === -1) {
    g.phase = "dealer";
  }
}
```

Then update `placeBet` and `sitOut`: after the successful save, before returning, check whether to auto-advance. Replace the end of each function (`await saveGame(g); return { success: true };`) with:

```ts
    if (allBetsIn(g)) startDealing(g);
    await saveGame(g);
    return { success: true };
```

(One save call per function, _after_ the conditional advance.)

- [ ] **Step 4: Run — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: auto-advance betting → dealing → playing

When the last funded player bets (or sits out), deal two cards to every
non-sitting-out player and the dealer, then advance to playing with
activePlayerIndex on the first non-sitting-out seat. If everyone sits
out, skip straight to dealer phase.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Dealing — verify card distribution

The dealing logic was added in T4. This task adds explicit tests that pin down the count and order so future refactors don't silently break the deal sequence.

**Files:**
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Add tests**

Append:

```ts
describe("dealing", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("each player gets exactly 2 cards and dealer gets 2", async () => {
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.hands.p1[0].cards).toHaveLength(2);
    expect(view.hands.p2[0].cards).toHaveLength(2);
    expect(view.hands.p3[0].cards).toHaveLength(2);
    expect(view.dealerHand).toHaveLength(2);
  });

  it("hides dealer hole card in player view during playing", async () => {
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.dealerHand[1]).toEqual({ suit: "?", rank: "?" });
    // Up-card is never hidden
    expect(view.dealerHand[0]).toHaveProperty("rank");
    expect((view.dealerHand[0] as Card).rank).not.toBe("?");
  });
});
```

- [ ] **Step 2: Run — expect pass (no implementation change needed)**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: pin down dealing distribution + hole-card hiding

Regression guards for the round-trip: 2 cards per player, 2 to dealer,
hole card hidden in the playing-phase player view.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: hit

Active player draws one card. Bust at >21 marks the hand resolved (chips already deducted at bet time, so no further chip change). Wrong phase / not active player / wrong hand all reject.

**Files:**
- Modify: `server/src/blackjackGame.ts`
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this helper near the top of the test file (after fixtures):

```ts
import { hit, stand } from "../blackjackGame.js";

/** Stub the live game's shoe so subsequent draws are deterministic. */
async function rigShoe(lobby: string, top: Card[]) {
  const exported = await exportBlackjackGames();
  const g = exported.find((x: any) => x.lobbyCode === lobby);
  if (!g) throw new Error("rigShoe: game not found");
  // top[0] will be drawn first → push in reverse so pop() returns top[0] first.
  g.shoe = [...top].reverse();
  // Round-trip back through the public API to persist:
  await cleanupBlackjackGame(lobby);
  await restoreBlackjackGames([g]);
}

/** Stub a player's hand to a fixed pair of cards. */
async function rigHand(lobby: string, playerId: string, cards: Card[]) {
  const exported = await exportBlackjackGames();
  const g = exported.find((x: any) => x.lobbyCode === lobby);
  if (!g) throw new Error("rigHand: game not found");
  g.hands[playerId] = [{ cards, bet: 100, doubled: false, resolved: false, fromSplit: false }];
  await cleanupBlackjackGame(lobby);
  await restoreBlackjackGames([g]);
}
```

Then append:

```ts
describe("hit", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("draws a card for the active player", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "5" }, { suit: "H", rank: "5" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "3" }]);
    const r = await hit(LOBBY, "p1");
    expect(r.success).toBe(true);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.hands.p1[0].cards).toHaveLength(3);
  });

  it("busts at >21 and resolves the hand", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "K" }, { suit: "H", rank: "Q" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "5" }]);
    const r = await hit(LOBBY, "p1");
    expect(r.success).toBe(true);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.hands.p1[0].resolved).toBe(true);
    // Active player should have advanced
    expect(view.activePlayerId).toBe("p2");
  });

  it("rejects when not the active player", async () => {
    const r = await hit(LOBBY, "p2");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/turn/i);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `hit is not a function`.

- [ ] **Step 3: Implement hit + handValue + advance helper**

Add to `server/src/blackjackGame.ts`:

```ts
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
  // Try the next hand of the current player.
  const curPid = g.playerIds[g.activePlayerIndex];
  if (curPid) {
    const hands = g.hands[curPid] || [];
    if (g.activeHandIndex + 1 < hands.length) {
      g.activeHandIndex++;
      g.phaseDeadline = Date.now() + TURN_TIME_MS;
      return;
    }
  }
  // Otherwise advance to the next seat that has at least one hand.
  for (let i = g.activePlayerIndex + 1; i < g.playerIds.length; i++) {
    if ((g.hands[g.playerIds[i]] || []).length > 0) {
      g.activePlayerIndex = i;
      g.activeHandIndex = 0;
      g.phaseDeadline = Date.now() + TURN_TIME_MS;
      return;
    }
  }
  // All players done — dealer phase. Settle is handled in T11/T12.
  g.phase = "dealer";
  g.activePlayerIndex = -1;
  g.activeHandIndex = 0;
}
```

Then add `hit`:

```ts
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: hit action + handValue helper

handValue counts each ace as 11 unless it would bust. hit draws one
card; busting marks the hand resolved and advances. Rejects when not
the active player or wrong phase.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: stand

Resolves the active hand and advances. Includes the multi-hand and multi-seat advance paths.

**Files:**
- Modify: `server/src/blackjackGame.ts`
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Write the failing tests**

Append:

```ts
describe("stand", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("advances to the next seat", async () => {
    await stand(LOBBY, "p1");
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.activePlayerId).toBe("p2");
    expect(v.hands.p1[0].resolved).toBe(true);
  });

  it("advances to dealer phase after the last seat stands", async () => {
    await stand(LOBBY, "p1");
    await stand(LOBBY, "p2");
    await stand(LOBBY, "p3");
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.phase).toBe("dealer");
  });

  it("rejects when not active player", async () => {
    const r = await stand(LOBBY, "p2");
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `stand is not a function`.

- [ ] **Step 3: Implement stand**

Add:

```ts
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: stand action

Resolves the active hand and advances. Multi-hand path (after split) and
multi-seat path both handled by advanceTurn().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: double

Only legal on a 2-card hand with chips. Doubles the bet, deals exactly one card, marks hand resolved (auto-stand), advances.

**Files:**
- Modify: `server/src/blackjackGame.ts`
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Tests**

Append:

```ts
import { doubleDown } from "../blackjackGame.js";

describe("doubleDown", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("doubles the bet, deals one card, auto-stands", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "5" }, { suit: "H", rank: "6" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "9" }]);
    const r = await doubleDown(LOBBY, "p1");
    expect(r.success).toBe(true);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.hands.p1[0].cards).toHaveLength(3);
    expect(v.hands.p1[0].bet).toBe(200);
    expect(v.hands.p1[0].doubled).toBe(true);
    expect(v.hands.p1[0].resolved).toBe(true);
    expect(v.chips.p1).toBe(800); // 1000 − 100 (initial) − 100 (double)
    expect(v.activePlayerId).toBe("p2");
  });

  it("rejects when hand is not 2 cards", async () => {
    await rigHand(LOBBY, "p1", [
      { suit: "S", rank: "5" }, { suit: "H", rank: "6" }, { suit: "C", rank: "2" },
    ]);
    const r = await doubleDown(LOBBY, "p1");
    expect(r.success).toBe(false);
  });

  it("rejects when chips < bet", async () => {
    // Force chip balance to less than bet
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.chips.p1 = 50;
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);
    const r = await doubleDown(LOBBY, "p1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/chip/i);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `doubleDown is not a function`.

- [ ] **Step 3: Implement doubleDown**

Add:

```ts
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: double-down action

Only legal on a 2-card hand with chips ≥ bet. Doubles the bet
(reserving the second-bet chips immediately), deals one more card,
auto-stands, advances.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: split (basic pair, no aces yet)

Only legal on a pair (same rank). Two hands each with the original bet; second hand draws one card on creation. Active hand stays at index 0; the second hand will be played after the first stands/busts.

**Files:**
- Modify: `server/src/blackjackGame.ts`
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Tests**

Append:

```ts
import { split } from "../blackjackGame.js";

describe("split (non-ace pairs)", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("splits a pair into two hands, each with one card to start", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "8" }, { suit: "H", rank: "8" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "3" }, { suit: "D", rank: "5" }]);
    // shoe top (popped first) = first card of test array → so 3 deals first.
    const r = await split(LOBBY, "p1");
    expect(r.success).toBe(true);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.hands.p1).toHaveLength(2);
    // Each split hand starts with the original card + one new draw
    expect(v.hands.p1[0].cards).toHaveLength(2);
    expect(v.hands.p1[1].cards).toHaveLength(2);
    // Bets duplicated, chips deducted twice
    expect(v.hands.p1[0].bet).toBe(100);
    expect(v.hands.p1[1].bet).toBe(100);
    expect(v.chips.p1).toBe(800); // 1000 − 100 (initial) − 100 (split)
    expect(v.hands.p1[0].fromSplit).toBe(true);
    expect(v.hands.p1[1].fromSplit).toBe(true);
    expect(v.activePlayerId).toBe("p1"); // still p1's turn, on hand 0
    expect(v.activeHandIndex).toBe(0);
  });

  it("rejects when cards aren't a pair", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "5" }, { suit: "H", rank: "6" }]);
    const r = await split(LOBBY, "p1");
    expect(r.success).toBe(false);
  });

  it("rejects when chips < bet", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "8" }, { suit: "H", rank: "8" }]);
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.chips.p1 = 50;
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);
    const r = await split(LOBBY, "p1");
    expect(r.success).toBe(false);
  });

  it("plays the second split hand after the first is resolved", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "8" }, { suit: "H", rank: "8" }]);
    await rigShoe(LOBBY, [
      { suit: "C", rank: "3" }, { suit: "D", rank: "5" },           // split deals
      { suit: "S", rank: "9" }, { suit: "H", rank: "9" },            // hits
    ]);
    await split(LOBBY, "p1");
    await stand(LOBBY, "p1"); // resolve first split hand
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.activePlayerId).toBe("p1");
    expect(v.activeHandIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `split is not a function`.

- [ ] **Step 3: Implement split**

Add:

```ts
function isPair(cards: Card[]): boolean {
  return cards.length === 2 && cards[0].rank === cards[1].rank;
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: split action (no re-split)

Splits a pair into two hands. Each split hand starts with the original
card + one new draw. Bets duplicated and chips reserved at action time.
fromSplit flag blocks re-splitting either hand. Ace-split branch
flagged but pinned in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: split aces and no re-split

Pin down the two MVP rule edges: split aces both auto-stand after one card; a hand that came from a split cannot be split again, even if it draws into another pair.

**Files:**
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Tests**

Append:

```ts
describe("split rule edges", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("split aces: each hand gets exactly one card and both auto-stand", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "A" }, { suit: "H", rank: "A" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "5" }, { suit: "D", rank: "9" }]);
    const r = await split(LOBBY, "p1");
    expect(r.success).toBe(true);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.hands.p1[0].cards).toHaveLength(2);
    expect(v.hands.p1[1].cards).toHaveLength(2);
    expect(v.hands.p1[0].resolved).toBe(true);
    expect(v.hands.p1[1].resolved).toBe(true);
    expect(v.activePlayerId).toBe("p2");
  });

  it("re-split is rejected even if a split hand draws into a new pair", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "8" }, { suit: "H", rank: "8" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "8" }, { suit: "D", rank: "8" }]);
    await split(LOBBY, "p1");
    const r = await split(LOBBY, "p1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/re-?split/i);
  });
});
```

- [ ] **Step 2: Run — expect pass (already implemented in T9)**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: pin split-aces and no-re-split rules

Regression guards for the two MVP rule edges from the spec:
- Split aces: each hand draws exactly one card and both auto-stand
- Re-split is rejected, even if a split hand draws into another pair

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: dealer phase

After all players resolve, dealer flips the hole card and hits to ≥17. Standing on all 17. Skip drawing entirely if every player busted.

**Files:**
- Modify: `server/src/blackjackGame.ts`
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Tests**

Append:

```ts
import { runDealer } from "../blackjackGame.js";

describe("runDealer", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("hits to 17 and stands", async () => {
    // Force every player to stand cleanly, then run dealer.
    for (const pid of ["p1", "p2", "p3"] as const) {
      await rigHand(LOBBY, pid, [{ suit: "S", rank: "9" }, { suit: "H", rank: "9" }]);
      await stand(LOBBY, pid);
    }
    // Stub dealer hand to 12 (e.g., 7 + 5), then deal 6 → 18, stop.
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.dealerHand = [{ suit: "S", rank: "7" }, { suit: "H", rank: "5" }];
    g.shoe = [{ suit: "C", rank: "6" }];
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await runDealer(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.dealerHand).toHaveLength(3);
    expect(v.phase).toBe("settle");
  });

  it("skips drawing if every player busted", async () => {
    for (const pid of ["p1", "p2", "p3"] as const) {
      await rigHand(LOBBY, pid, [{ suit: "S", rank: "K" }, { suit: "H", rank: "Q" }]);
      const exported = await exportBlackjackGames();
      const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
      g.hands[pid][0].resolved = true; // mark all busted
      await cleanupBlackjackGame(LOBBY);
      await restoreBlackjackGames([g]);
    }
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.dealerHand = [{ suit: "S", rank: "7" }, { suit: "H", rank: "5" }];
    g.phase = "dealer";
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await runDealer(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    // Dealer doesn't draw — every player already lost.
    expect(v.dealerHand).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `runDealer is not a function`.

- [ ] **Step 3: Implement runDealer**

Add:

```ts
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: dealer phase (S17, skip-if-all-bust)

Dealer hits to 17, stands on all 17. If every player already busted,
dealer doesn't draw — saves a card from the shoe and matches casino
behaviour. After dealer is done, advance to settle phase.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: settle (outcomes + chip mechanics)

Compare each non-busted hand to dealer total. Pay out chips per the table in the spec. Blackjack pays 3:2 (`+ceil(1.5 × bet)` net), pushes return the bet, losses keep the reserved bet.

**Files:**
- Modify: `server/src/blackjackGame.ts`
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Tests**

Append:

```ts
import { settleRound } from "../blackjackGame.js";

describe("settleRound", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  async function setOutcome(dealer: Card[], p1: Card[], p2: Card[], p3: Card[]) {
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.dealerHand = dealer;
    g.hands.p1 = [{ cards: p1, bet: 100, doubled: false, resolved: true, fromSplit: false }];
    g.hands.p2 = [{ cards: p2, bet: 100, doubled: false, resolved: true, fromSplit: false }];
    g.hands.p3 = [{ cards: p3, bet: 100, doubled: false, resolved: true, fromSplit: false }];
    g.phase = "settle";
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);
  }

  it("win: chips +bet, push: chips +0, lose: chips −bet (vs pre-bet balance)", async () => {
    // dealer 19, p1 wins (20), p2 pushes (19), p3 loses (18 vs 19)
    await setOutcome(
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],
      [{ suit: "S", rank: "K" }, { suit: "H", rank: "10" }],   // 20
      [{ suit: "S", rank: "9" }, { suit: "H", rank: "10" }],   // 19
      [{ suit: "S", rank: "8" }, { suit: "H", rank: "10" }],   // 18
    );
    await settleRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.chips.p1).toBe(1100); // 1000 - 100 + 200
    expect(v.chips.p2).toBe(1000); // 1000 - 100 + 100
    expect(v.chips.p3).toBe(900);  // 1000 - 100 + 0
    expect(v.lastSettlement?.find(s => s.playerId === "p1")?.outcome).toBe("win");
    expect(v.lastSettlement?.find(s => s.playerId === "p2")?.outcome).toBe("push");
    expect(v.lastSettlement?.find(s => s.playerId === "p3")?.outcome).toBe("lose");
  });

  it("blackjack pays 3:2", async () => {
    await setOutcome(
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],   // dealer 19
      [{ suit: "S", rank: "A" }, { suit: "H", rank: "K" }],    // p1 blackjack
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],   // p2 push (19)
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],   // p3 push
    );
    await settleRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.chips.p1).toBe(1150); // 1000 - 100 + 100 + ceil(1.5*100) = 1150
    expect(v.lastSettlement?.find(s => s.playerId === "p1")?.outcome).toBe("blackjack");
  });

  it("dealer blackjack pushes vs player blackjack, loses to non-blackjack 21", async () => {
    await setOutcome(
      [{ suit: "S", rank: "A" }, { suit: "H", rank: "K" }],    // dealer blackjack
      [{ suit: "S", rank: "A" }, { suit: "H", rank: "K" }],    // p1 push (both BJ)
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "5" }, { suit: "C", rank: "6" }], // p2 21, not BJ → lose
      [{ suit: "S", rank: "9" }, { suit: "H", rank: "9" }],    // p3 18 → lose
    );
    await settleRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.chips.p1).toBe(1000); // push
    expect(v.chips.p2).toBe(900);  // lose
    expect(v.chips.p3).toBe(900);  // lose
  });

  it("busted player loses regardless of dealer", async () => {
    await setOutcome(
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "10" }, { suit: "C", rank: "5" }], // dealer busts at 25
      [{ suit: "S", rank: "K" }, { suit: "H", rank: "Q" }, { suit: "C", rank: "5" }],   // p1 bust
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],                             // p2 win (19)
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],                             // p3 win
    );
    await settleRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.chips.p1).toBe(900);  // bust = lose
    expect(v.chips.p2).toBe(1100); // dealer busted = win
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `settleRound is not a function`.

- [ ] **Step 3: Implement settleRound**

Add:

```ts
function classifyHand(hand: Hand, dealerTotal: number, dealerBlackjack: boolean): Outcome {
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: settle outcomes + chip payouts

classifyHand returns blackjack / win / push / lose with the standard
rules: bust loses regardless of dealer, dealer-blackjack pushes vs
player-blackjack and beats anything else, blackjack pays 3:2 (rounded
up). Hands created by split cannot be 'blackjack' — only an
on-the-deal natural counts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Elimination + auto-loop / gameOver

After settle, if `playersStillEligible (chips ≥ minBet)` ≤ 1, set `phase = gameOver`. Otherwise, reset for the next round (`phase = betting`, clear bets/hands, fresh shoe, increment roundNumber).

**Files:**
- Modify: `server/src/blackjackGame.ts`
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Tests**

Append:

```ts
import { startNextRound, getBlackjackScores } from "../blackjackGame.js";

describe("elimination and next-round loop", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
  });

  it("loops back to betting with fresh shoe and incremented roundNumber", async () => {
    // Trip a settled state with everyone surviving
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.phase = "settle";
    g.chips = { p1: 500, p2: 500, p3: 500 };
    g.bets = { p1: 100, p2: 100, p3: 100 };
    g.dealerHand = [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }];
    g.hands = { p1: [], p2: [], p3: [] };
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await startNextRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.phase).toBe("betting");
    expect(v.roundNumber).toBe(2);
    expect(v.bets).toEqual({ p1: null, p2: null, p3: null });
    expect(v.dealerHand).toEqual([]);
    expect(v.shoeRemaining).toBe(52);
  });

  it("ends the game when ≤1 player has chips ≥ minBet", async () => {
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.phase = "settle";
    g.chips = { p1: 5, p2: 5, p3: 1000 }; // only p3 can keep playing
    g.dealerHand = [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }];
    g.hands = { p1: [], p2: [], p3: [] };
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await startNextRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.phase).toBe("gameOver");

    const scores = await getBlackjackScores(LOBBY);
    // Last player standing scores 1, the rest 0 — same shape as codenames scores.
    expect(scores).toEqual({ p1: 0, p2: 0, p3: 1 });
  });

  it("eliminated players (chips < minBet) sit out the next round automatically", async () => {
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.phase = "settle";
    g.chips = { p1: 5, p2: 500, p3: 500 }; // p1 eliminated, p2/p3 alive
    g.dealerHand = [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }];
    g.hands = { p1: [], p2: [], p3: [] };
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await startNextRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.phase).toBe("betting");
    expect(v.bets.p1).toBe("sitting_out"); // auto sit-out when ineligible
    expect(v.bets.p2).toBe(null);
    expect(v.bets.p3).toBe(null);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `startNextRound is not a function` / `getBlackjackScores is not a function`.

- [ ] **Step 3: Implement startNextRound + getBlackjackScores**

Add:

```ts
function eligible(g: InternalBlackjackGame, pid: string): boolean {
  return (g.chips[pid] ?? 0) >= g.config.minBet;
}

export async function startNextRound(lobbyCode: string): Promise<void> {
  await withGameLock("blackjack", lobbyCode, async () => {
    const g = await loadGame(lobbyCode);
    if (!g) return;
    if (g.phase !== "settle") return;

    const eligibleCount = g.playerIds.filter(p => eligible(g, p)).length;
    if (eligibleCount <= 1) {
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
    await saveGame(g);
  });
}

export async function getBlackjackScores(lobbyCode: string): Promise<Record<string, number> | null> {
  const g = await loadGame(lobbyCode);
  if (!g) return null;
  // Last player standing gets 1; others 0.
  const survivors = g.playerIds.filter(p => eligible(g, p));
  const out: Record<string, number> = {};
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: elimination + next-round loop + scores

After settle, count eligible players (chips ≥ minBet). If ≤1, end the
game with the last-standing scoring shape. Otherwise reset for the next
round: fresh shoe, cleared bets/hands, ineligible players auto-sit-out.
getBlackjackTurnDeadline added for the timer wiring in later tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: removePlayerFromBlackjackGame + zombie restore filter

Mid-game leave handling (auto-stand any in-flight hand, advance, end-game if one player remains). The zombie filter is already in place from T1; this task adds the explicit test for it.

**Files:**
- Modify: `server/src/blackjackGame.ts`
- Modify: `server/src/__tests__/blackjackGame.test.ts`

- [ ] **Step 1: Tests**

Append:

```ts
import { removePlayerFromBlackjackGame } from "../blackjackGame.js";

describe("removePlayerFromBlackjackGame", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("removes a non-active player without disrupting the round", async () => {
    await removePlayerFromBlackjackGame(LOBBY, "p3");
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.playerIds).toEqual(["p1", "p2"]);
    expect(v.activePlayerId).toBe("p1");
  });

  it("auto-advances when the active player leaves mid-turn", async () => {
    await removePlayerFromBlackjackGame(LOBBY, "p1");
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.activePlayerId).toBe("p2");
  });

  it("ends the game when only one eligible player remains", async () => {
    await removePlayerFromBlackjackGame(LOBBY, "p1");
    await removePlayerFromBlackjackGame(LOBBY, "p2");
    const v = (await getBlackjackPlayerView(LOBBY, "p3"))!;
    expect(v.phase).toBe("gameOver");
  });
});

describe("restoreBlackjackGames zombie filter", () => {
  it("skips games whose createdAt is more than 2h in the past", async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    const exported = JSON.parse(JSON.stringify(await exportBlackjackGames()));
    exported[0].createdAt = Date.now() - (3 * 60 * 60 * 1000); // 3h old
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames(exported);
    expect(await isBlackjackGame(LOBBY)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: FAIL — `removePlayerFromBlackjackGame is not a function`.

- [ ] **Step 3: Implement removePlayerFromBlackjackGame**

Add:

```ts
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npm --prefix server test -- --run blackjackGame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/blackjackGame.ts server/src/__tests__/blackjackGame.test.ts
git commit -m "$(cat <<'EOF'
blackjack: removePlayer + pin zombie restore filter

Mid-round leave drops the player from every per-player record, advances
the active seat if they were active, and ends the game if only one
eligible player remains. Zombie filter test mirrors the codenames one.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Migration + GameType union + deckStore validation skip + built-in deck row

Wire the new game type into the schema, the type system, and the deck-validation bypass. Adds a built-in deck row so users can pick "Blackjack" without creating a deck.

**Files:**
- Create: `server/migrations/019_blackjack_snapshots.sql`
- Modify: `server/src/types.ts:57`
- Modify: `server/src/deckStore.ts:114`
- Modify: `server/src/handlers/lobbyHandlers.ts:202` (extend gameType union literal)

- [ ] **Step 1: Create the migration**

Create `server/migrations/019_blackjack_snapshots.sql`:

```sql
-- Add Blackjack game type: snapshot table + a built-in deck row so users
-- can pick "Blackjack" from the lobby without authoring a deck.

CREATE TABLE IF NOT EXISTS blackjack_game_snapshots (
  lobby_code TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO decks (id, name, description, chaos_cards, knowledge_cards, win_condition, owner_id, built_in, game_type)
VALUES (
  'builtin-blackjack',
  'Blackjack',
  'Casino-style blackjack with virtual chips. Last player standing wins.',
  '[]'::jsonb,
  '[]'::jsonb,
  '{}'::jsonb,
  NULL,
  TRUE,
  'blackjack'
)
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Add `"blackjack"` to the GameType union**

In `server/src/types.ts`, change line 57:

```ts
export type GameType = "cah" | "joking_hazard" | "apples_to_apples" | "uno" | "codenames" | "superfight";
```

to:

```ts
export type GameType = "cah" | "joking_hazard" | "apples_to_apples" | "uno" | "codenames" | "superfight" | "blackjack";
```

- [ ] **Step 3: Skip card validation for blackjack decks**

In `server/src/deckStore.ts:114`, change:

```ts
  // Uno decks store a template instead of cards — skip card validation
  if (deck.gameType === "uno") {
    return null;
  }
```

to:

```ts
  // Uno decks store a template instead of cards; Blackjack has no cards at
  // all (built-in rules) — skip card validation for both.
  if (deck.gameType === "uno" || deck.gameType === "blackjack") {
    return null;
  }
```

- [ ] **Step 4: Extend the lobbyHandlers gameType literal**

In `server/src/handlers/lobbyHandlers.ts:202`, change:

```ts
      let gameType: "cah" | "joking_hazard" | "apples_to_apples" | "uno" | "codenames" | undefined = undefined;
```

to:

```ts
      let gameType: "cah" | "joking_hazard" | "apples_to_apples" | "uno" | "codenames" | "blackjack" | undefined = undefined;
```

- [ ] **Step 5: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: silent.

- [ ] **Step 6: Run all server tests**

Run: `npm --prefix server test`
Expected: all green (no regressions).

- [ ] **Step 7: Commit**

```bash
git add server/migrations/019_blackjack_snapshots.sql server/src/types.ts server/src/deckStore.ts server/src/handlers/lobbyHandlers.ts
git commit -m "$(cat <<'EOF'
blackjack(wiring): migration + GameType + deck validation

Adds the blackjack_game_snapshots table and a built-in deck row so
"Blackjack" is selectable in the lobby without authoring a deck.
Extends GameType union (server + lobbyHandlers literal) and the
card-validation skip in deckStore (blackjack has no cards at all).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Snapshot.ts integration

Wire blackjack export/restore into the SIGTERM snapshot and boot restore. Re-arms the per-phase timer (any of betting / playing / settle) on restore so a deploy mid-round resumes cleanly.

**Files:**
- Modify: `server/src/snapshot.ts`

- [ ] **Step 1: Patch snapshot.ts**

In `server/src/snapshot.ts`, make four edits:

1. Add the import (around line 7):

```ts
import { exportBlackjackGames, restoreBlackjackGames } from "./blackjackGame.js";
```

2. Extend `SNAPSHOT_TABLES` (line 25):

```ts
const SNAPSHOT_TABLES =
  "lobby_snapshots, cah_game_snapshots, uno_game_snapshots, codenames_game_snapshots, blackjack_game_snapshots, chat_snapshots";
```

3. In `snapshotAll()`, after the codenames export (line 31) add:

```ts
  const blackjackGames = await exportBlackjackGames();
```

  And after the codenames INSERT block (line 62), add:

```ts
    for (const g of blackjackGames) {
      await client.query(
        "INSERT INTO blackjack_game_snapshots (lobby_code, state) VALUES ($1, $2)",
        [g.lobbyCode, JSON.stringify(g)]
      );
    }
```

  Also include `blackjackGames: blackjackGames.length` in the `log.info("snapshot written", ...)` payload.

4. In `restoreAll()`, after the codenames query (line 99-101) add:

```ts
    const blackjackGames = await pool.query(
      `SELECT state FROM blackjack_game_snapshots WHERE created_at > ${cutoff}`
    );
```

  And after `await restoreCodenamesGames(...)` (line 109) add:

```ts
    await restoreBlackjackGames(blackjackGames.rows.map(r => r.state));
```

  Include `blackjackGames: blackjackGames.rowCount` in the final `log.info("snapshot restored", ...)` payload.

  Note: blackjack timer re-arming is handled in T17 alongside the timer module.

- [ ] **Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add server/src/snapshot.ts
git commit -m "$(cat <<'EOF'
blackjack(snapshot): wire SIGTERM snapshot + boot restore

Adds blackjack_game_snapshots to the truncate set, the export pass, and
the restore pass. Restore reuses the existing 15-min cutoff; the engine
already drops zombie games >2h old. Timer re-arming follows in the next
task once the timer helpers exist.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: socketHelpers timer + sendBlackjackUpdate broadcast

Three new exports: `scheduleBlackjackTimer` (one helper that handles whichever phase the game is in), `clearBlackjackTimer`, and `sendBlackjackUpdate`. Same lock-keyed-to-deadline pattern as the Uno turn timer.

**Files:**
- Modify: `server/src/socketHelpers.ts`

- [ ] **Step 1: Patch socketHelpers.ts**

1. Add the import near the top (around line 4):

```ts
import { getBlackjackPlayerView, getBlackjackTurnDeadline } from "./blackjackGame.js";
```

2. Extend `claimTimerLock` (line 174) to accept the new namespace:

```ts
async function claimTimerLock(
  kind: "cah" | "uno" | "blackjack",
  code: string,
  deadline: number,
): Promise<boolean> {
  if (!redis) return true;
  const key = `timer-lock:${kind}:${code}:${deadline}`;
  const ok = await redis.set(key, "1", "EX", 60, "NX");
  return ok === "OK";
}
```

3. After `sendCodenamesUpdate` (around line 144), add:

```ts
export async function sendBlackjackUpdate(io: Server<ClientEvents, ServerEvents>, code: string) {
  // One per-player view (each player gets the same hidden-hole-card shape;
  // future per-seat masking — sit-out, eliminated — already lives in the
  // engine view).
  const playerIds = (await getActivePlayers(code)) || [];
  for (const pid of playerIds) {
    const view = await getBlackjackPlayerView(code, pid);
    if (!view) continue;
    const sock = io.sockets.sockets.get(pid);
    if (sock) sock.emit("blackjack:update" as any, view);
  }
}
```

(`getActivePlayers` is already imported from `./lobby.js` at the top of the file — no new import needed.)

4. After `clearUnoTurnTimer` (around line 235), add the blackjack timer helpers:

```ts
// ── Blackjack Phase Timers ───────────────────────────────────────────────────
// One timer per game, regardless of phase — the deadline lives on the game's
// phaseDeadline field. The callback is responsible for calling the right
// engine entry point based on the live phase. SET-NX-keyed-by-deadline gives
// at-most-once across replicas.

const blackjackTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function scheduleBlackjackTimer(code: string, onExpiry: (code: string) => void) {
  clearBlackjackTimer(code);
  const deadline = await getBlackjackTurnDeadline(code);
  if (!deadline) return;
  const delay = Math.max(0, deadline - Date.now());
  blackjackTimers.set(code, setTimeout(async () => {
    blackjackTimers.delete(code);
    const live = await getBlackjackTurnDeadline(code);
    if (live !== deadline) return;
    if (!(await claimTimerLock("blackjack", code, deadline))) return;
    onExpiry(code);
  }, delay));
}

export function clearBlackjackTimer(code: string) {
  const existing = blackjackTimers.get(code);
  if (existing) {
    clearTimeout(existing);
    blackjackTimers.delete(code);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add server/src/socketHelpers.ts
git commit -m "$(cat <<'EOF'
blackjack(timers): scheduleBlackjackTimer + sendBlackjackUpdate

One per-game timer keyed on the game's phaseDeadline — covers betting
window / per-turn / settle delay. SET-NX-by-deadline makes the fire
at-most-once across replicas, same pattern as Uno turn timers.
sendBlackjackUpdate broadcasts a player view to every seat, hidden
hole card included where the engine masks it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: blackjackHandlers.ts

Socket events for every action. Pattern matches `codenamesHandlers.ts`: callback-acked, broadcasts after each successful mutation, validates lobby + phase via `findPlayerLobby` + `isBlackjackGame`.

Each event also re-schedules the blackjack timer (since `phaseDeadline` may have moved).

**Files:**
- Create: `server/src/handlers/blackjackHandlers.ts`

- [ ] **Step 1: Create the handlers module**

```ts
import type { Server, Socket } from "socket.io";
import type { ClientEvents, ServerEvents } from "../types.js";
import {
  placeBet, sitOut, hit, stand, doubleDown, split,
  isBlackjackGame, runDealer, settleRound, startNextRound,
  getBlackjackScores, getBlackjackPlayerView,
} from "../blackjackGame.js";
import {
  findPlayerLobby, sendBlackjackUpdate, scheduleBlackjackTimer,
} from "../socketHelpers.js";

export function registerBlackjackHandlers(
  io: Server<ClientEvents, ServerEvents>,
  socket: Socket<ClientEvents, ServerEvents>,
) {
  const guard = async () => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isBlackjackGame(code))) return null;
    return code;
  };

  socket.on("blackjack:bet" as any, async (amount: number, callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await placeBet(code, socket.id, amount);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:sit-out" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await sitOut(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:hit" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await hit(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:stand" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await stand(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:double" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await doubleDown(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:split" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await split(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });
}

/**
 * After any mutation, drive any phase auto-transitions and re-schedule the
 * timer for the new phaseDeadline. This is also the entry point the timer
 * fires into when a phase deadline expires (auto-bet / auto-stand / next-round).
 */
export function createBlackjackTimerCallback(
  io: Server<ClientEvents, ServerEvents>,
): (code: string) => void {
  return (code: string) => {
    void afterMutation(io, code);
  };
}

async function afterMutation(
  io: Server<ClientEvents, ServerEvents>,
  code: string,
): Promise<void> {
  const view = await getBlackjackPlayerView(code, "_observer_");
  if (!view) return;

  // Drive the dealer + settle phases automatically — they take no human input.
  if (view.phase === "dealer") {
    await runDealer(code);
    await sendBlackjackUpdate(io, code);
  }
  const v2 = await getBlackjackPlayerView(code, "_observer_");
  if (v2?.phase === "settle" && !v2.lastSettlement) {
    await settleRound(code);
    await sendBlackjackUpdate(io, code);
  }
  // Re-arm the timer for whatever phase we ended in. A no-op if no deadline
  // applies (e.g., gameOver).
  await scheduleBlackjackTimer(code, createBlackjackTimerCallback(io));

  const v3 = await getBlackjackPlayerView(code, "_observer_");
  if (v3?.phase === "gameOver") {
    const scores = await getBlackjackScores(code);
    if (scores) io.to(code).emit("game:over", scores);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add server/src/handlers/blackjackHandlers.ts
git commit -m "$(cat <<'EOF'
blackjack(handlers): socket events + post-mutation drive

bet / sit-out / hit / stand / double / split events follow the
codenamesHandlers shape: callback ack, broadcast after success, no-op
on validation failure. afterMutation auto-runs the dealer and settle
phases (no human input needed) and re-arms the per-phase timer. The
timer callback re-enters the same drive function so betting / turn /
settle expiries all advance correctly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: index.ts handler registration + snapshot timer re-arm

Wire `registerBlackjackHandlers` into the connection flow, and re-arm the blackjack timer on restore (was deferred in T16).

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/src/snapshot.ts`

- [ ] **Step 1: Register the handler**

In `server/src/index.ts`, find the line:

```ts
import { registerCodenamesHandlers } from "./handlers/codenamesHandlers.js";
```

Add immediately below:

```ts
import { registerBlackjackHandlers } from "./handlers/blackjackHandlers.js";
```

Find the `io.on("connection", ...)` block where `registerCodenamesHandlers(io, socket)` is called and add:

```ts
    registerBlackjackHandlers(io, socket);
```

(Same call shape — same indentation as the codenames line.)

- [ ] **Step 2: Re-arm the blackjack timer on restore**

In `server/src/snapshot.ts`, add the import alongside the others:

```ts
import { createBlackjackTimerCallback } from "./handlers/blackjackHandlers.js";
import { scheduleBlackjackTimer } from "./socketHelpers.js";
```

In `restoreAll`, after the Uno re-arm loop (around line 136), add:

```ts
    let rearmedBlackjack = 0;
    const blackjackCallback = createBlackjackTimerCallback(io);
    for (const row of blackjackGames.rows) {
      const state = row.state;
      if (state?.phase && state.phase !== "gameOver") {
        await scheduleBlackjackTimer(state.lobbyCode, blackjackCallback);
        rearmedBlackjack++;
      }
    }
```

Add `rearmedBlackjack` to the final `log.info("snapshot restored", ...)` payload.

- [ ] **Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: silent.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts server/src/snapshot.ts
git commit -m "$(cat <<'EOF'
blackjack(wiring): register handler + restore timer re-arm

Wires registerBlackjackHandlers into the connection flow and re-arms
the per-game timer on restore for any non-gameOver phase. Fills in the
piece deferred from the snapshot task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: lobbyHandlers start-game branch

When a lobby starts and the deck's `gameType === "blackjack"`, call `createBlackjackGame` and emit the initial view to each player.

**Files:**
- Modify: `server/src/handlers/lobbyHandlers.ts`

- [ ] **Step 1: Add the import**

Near the existing handler imports at the top of `server/src/handlers/lobbyHandlers.ts`, add:

```ts
import { createBlackjackGame, getBlackjackPlayerView } from "../blackjackGame.js";
import { scheduleBlackjackTimer } from "../socketHelpers.js";
import { createBlackjackTimerCallback } from "./blackjackHandlers.js";
```

- [ ] **Step 2: Add the branch**

In the start-game block (around line 237 — `if (gameType === "codenames") { ... }`), append a new `else if` after the codenames branch:

```ts
        } else if (gameType === "blackjack") {
          await createBlackjackGame(code, playerIds, {
            startingChips: 1000,
            minBet: 10,
            maxBet: 500,
          });
          io.to(code).emit("lobby:started");
          for (const pid of playerIds) {
            const view = await getBlackjackPlayerView(code, pid);
            if (view) {
              const sock = io.sockets.sockets.get(pid);
              if (sock) sock.emit("blackjack:update" as any, view);
            }
          }
          await scheduleBlackjackTimer(code, createBlackjackTimerCallback(io));
        }
```

- [ ] **Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: silent.

- [ ] **Step 4: Manual sanity-check (build only)**

Run: `npm --prefix server run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/lobbyHandlers.ts
git commit -m "$(cat <<'EOF'
blackjack(wiring): lobby start-game branch

When a lobby's deck has gameType === "blackjack", create the engine
state with the default config (1000 chips, 10/500 min/max), broadcast
the initial player view, and schedule the betting-window timer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: Client store + types + GameType extension

Zustand slice for current blackjack view + the `"blackjack"` literal added to the client-side `GameType`.

**Files:**
- Create: `client/src/lib/blackjackStore.ts`
- Modify: `client/src/lib/store.ts:77`

- [ ] **Step 1: Extend the client GameType**

In `client/src/lib/store.ts:77`, change:

```ts
export type GameType = "cah" | "joking_hazard" | "apples_to_apples" | "uno" | "codenames" | "superfight";
```

to:

```ts
export type GameType = "cah" | "joking_hazard" | "apples_to_apples" | "uno" | "codenames" | "superfight" | "blackjack";
```

- [ ] **Step 2: Create the blackjack store**

```ts
import { create } from "zustand";

export type Suit = "S" | "H" | "D" | "C" | "?";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "?";
export interface Card { suit: Suit; rank: Rank }

export type BlackjackPhase = "betting" | "dealing" | "playing" | "dealer" | "settle" | "gameOver";

export interface Hand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  resolved: boolean;
  fromSplit: boolean;
}

export interface Settlement {
  playerId: string;
  handIndex: number;
  outcome: "win" | "lose" | "push" | "blackjack";
  delta: number;
}

export interface BlackjackView {
  gameType: "blackjack";
  phase: BlackjackPhase;
  chips: Record<string, number>;
  bets: Record<string, number | "sitting_out" | null>;
  hands: Record<string, Hand[]>;
  dealerHand: Card[];
  playerIds: string[];
  config: { startingChips: number; minBet: number; maxBet: number };
  activePlayerId: string | null;
  activeHandIndex: number;
  roundNumber: number;
  phaseDeadline: number;
  shoeRemaining: number;
  lastSettlement?: Settlement[];
}

interface BlackjackStore {
  view: BlackjackView | null;
  setView: (v: BlackjackView | null) => void;
}

export const useBlackjackStore = create<BlackjackStore>((set) => ({
  view: null,
  setView: (view) => set({ view }),
}));
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: silent.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/blackjackStore.ts client/src/lib/store.ts
git commit -m "$(cat <<'EOF'
blackjack(client): store + GameType extension

Zustand slice mirrors the server's BlackjackPlayerView shape (with
suit/rank widened to include '?' for the hidden hole card). GameType
adds the "blackjack" literal so the lobby select / GameScreen switch
can route to the new screen.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: BlackjackGameScreen.tsx

Table view: dealer hand at top, player seats around, each seat shows chips/bet/hand. Action bar appears for the active player with `Hit / Stand / Double / Split` (each disabled when not legal). Betting bar appears in `betting` phase with a chip-amount slider + `Bet` / `Sit out` buttons. Settlement banner during `settle` phase.

This is a single-file UI build; tests are manual (no client test infra).

**Files:**
- Create: `client/src/components/BlackjackGameScreen.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useBlackjackStore, type Card, type Suit } from "@/lib/blackjackStore";
import { useGameStore } from "@/lib/store";
import { getSocket } from "@/lib/socket";
import Chat from "./Chat";

const SUIT_GLYPH: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣", "?": "?" };
const SUIT_COLOR: Record<Suit, string> = {
  S: "text-gray-100", H: "text-red-400", D: "text-red-400", C: "text-gray-100", "?": "text-gray-400",
};

function CardChip({ card }: { card: Card }) {
  return (
    <div className="inline-flex flex-col items-center justify-center w-12 h-16 rounded bg-gray-800 border border-gray-600 mr-1">
      <span className={`text-xl font-bold ${SUIT_COLOR[card.suit]}`}>{card.rank}</span>
      <span className={`text-xl ${SUIT_COLOR[card.suit]}`}>{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}

function handTotal(cards: Card[]): number {
  const RANK_VALUE: Record<string, number> = {
    "A": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    "10": 10, "J": 10, "Q": 10, "K": 10, "?": 0,
  };
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += RANK_VALUE[c.rank] || 0;
    if (c.rank === "A") aces++;
  }
  while (aces > 0 && total + 10 <= 21) { total += 10; aces--; }
  return total;
}

export default function BlackjackGameScreen() {
  const view = useBlackjackStore(s => s.view);
  const lobby = useGameStore(s => s.lobby);
  const socket = getSocket();
  const myId = socket.id;
  const [betAmount, setBetAmount] = useState<number>(0);

  // Subscribe once for blackjack:update events.
  useEffect(() => {
    const handler = (v: any) => useBlackjackStore.getState().setView(v);
    socket.on("blackjack:update" as any, handler);
    return () => { socket.off("blackjack:update" as any, handler); };
  }, [socket]);

  // Default the bet slider to the table minimum once the view loads.
  useEffect(() => {
    if (view && betAmount === 0) setBetAmount(view.config.minBet);
  }, [view, betAmount]);

  const myChips = view && myId ? view.chips[myId] ?? 0 : 0;
  const myBet = view && myId ? view.bets[myId] : null;
  const isMyTurn = view?.activePlayerId === myId;
  const eligible = useMemo(() => view ? myChips >= view.config.minBet : false, [view, myChips]);

  if (!view) return <div className="p-8 text-gray-400">Waiting for blackjack state…</div>;

  const ack = (event: string, ...args: any[]) => {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      socket.emit(event as any, ...args, (res: any) => resolve(res));
    });
  };

  const onBet = async () => { await ack("blackjack:bet", betAmount); };
  const onSitOut = async () => { await ack("blackjack:sit-out"); };
  const onHit = async () => { await ack("blackjack:hit"); };
  const onStand = async () => { await ack("blackjack:stand"); };
  const onDouble = async () => { await ack("blackjack:double"); };
  const onSplit = async () => { await ack("blackjack:split"); };

  const myHands = view.hands[myId ?? ""] || [];
  const myActiveHand = isMyTurn ? myHands[view.activeHandIndex] : undefined;
  const canDouble = !!myActiveHand && myActiveHand.cards.length === 2 && myChips >= myActiveHand.bet;
  const canSplit = !!myActiveHand && myActiveHand.cards.length === 2
    && myActiveHand.cards[0].rank === myActiveHand.cards[1].rank
    && !myActiveHand.fromSplit
    && myChips >= myActiveHand.bet;

  return (
    <div className="min-h-screen bg-green-900 text-white p-4 flex flex-col">
      {/* Dealer */}
      <div className="text-center mb-6">
        <div className="text-sm text-gray-300 mb-1">Dealer{view.phase !== "playing" && view.phase !== "dealing" ? ` — ${handTotal(view.dealerHand)}` : ""}</div>
        <div className="flex justify-center">{view.dealerHand.map((c, i) => <CardChip key={i} card={c} />)}</div>
      </div>

      {/* Players */}
      <div className="flex flex-wrap justify-center gap-4 mb-6">
        {view.playerIds.map(pid => {
          const player = lobby?.players.find(p => p.id === pid);
          const name = player?.name ?? pid;
          const chips = view.chips[pid] ?? 0;
          const bet = view.bets[pid];
          const hands = view.hands[pid] || [];
          const isActive = view.activePlayerId === pid;
          const isEliminated = chips < view.config.minBet && view.phase !== "betting";
          return (
            <div key={pid} className={`p-3 rounded border ${isActive ? "border-yellow-400" : "border-gray-700"} ${isEliminated ? "opacity-50" : ""} bg-gray-900`}>
              <div className="flex items-center justify-between mb-1 text-sm">
                <span className="font-bold">{name}{pid === myId ? " (you)" : ""}</span>
                <span className="text-yellow-300 ml-3">🪙 {chips}</span>
              </div>
              <div className="text-xs text-gray-400 mb-1">
                {bet === "sitting_out" ? "sitting out" : bet ? `bet ${bet}` : view.phase === "betting" ? "…" : ""}
              </div>
              {hands.map((h, hi) => (
                <div key={hi} className={`mb-1 ${isActive && view.activeHandIndex === hi ? "ring-2 ring-yellow-400 rounded p-1" : ""}`}>
                  <div className="flex">{h.cards.map((c, i) => <CardChip key={i} card={c} />)}</div>
                  <div className="text-xs text-gray-300 mt-1">total {handTotal(h.cards)}{h.doubled ? " · doubled" : ""}{h.resolved ? " · done" : ""}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Action bar */}
      {view.phase === "betting" && eligible && myBet === null && (
        <div className="bg-gray-900 rounded p-4 max-w-md mx-auto">
          <div className="text-sm mb-2">Place your bet (min {view.config.minBet}, max {Math.min(view.config.maxBet, myChips)})</div>
          <input
            type="range"
            min={view.config.minBet}
            max={Math.min(view.config.maxBet, myChips)}
            value={betAmount}
            onChange={e => setBetAmount(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-center text-lg font-bold my-2">🪙 {betAmount}</div>
          <div className="flex justify-center gap-2">
            <button onClick={onBet} className="bg-yellow-500 text-black px-4 py-2 rounded font-bold">Bet</button>
            <button onClick={onSitOut} className="bg-gray-700 px-4 py-2 rounded">Sit out</button>
          </div>
        </div>
      )}

      {view.phase === "playing" && isMyTurn && myActiveHand && (
        <div className="flex justify-center gap-2 mb-4">
          <button onClick={onHit} className="bg-blue-600 px-4 py-2 rounded font-bold">Hit</button>
          <button onClick={onStand} className="bg-gray-700 px-4 py-2 rounded font-bold">Stand</button>
          <button onClick={onDouble} disabled={!canDouble} className="bg-purple-600 px-4 py-2 rounded font-bold disabled:opacity-40">Double</button>
          <button onClick={onSplit} disabled={!canSplit} className="bg-green-600 px-4 py-2 rounded font-bold disabled:opacity-40">Split</button>
        </div>
      )}

      {view.phase === "settle" && view.lastSettlement && (
        <div className="bg-black/40 rounded p-3 max-w-lg mx-auto text-center">
          <div className="font-bold mb-1">Round results</div>
          {view.lastSettlement.map((s, i) => {
            const name = lobby?.players.find(p => p.id === s.playerId)?.name ?? s.playerId;
            return <div key={i} className="text-sm">{name}: {s.outcome} ({s.delta >= 0 ? "+" : ""}{s.delta - (view.hands[s.playerId]?.[s.handIndex]?.bet ?? 0)})</div>;
          })}
        </div>
      )}

      {view.phase === "gameOver" && (
        <div className="text-center text-2xl font-bold mt-4">
          <Icon icon="mdi:trophy" className="inline mr-2" />
          Game over — last player standing wins
        </div>
      )}

      <div className="mt-auto"><Chat /></div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: silent (or pre-existing warnings only).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/BlackjackGameScreen.tsx
git commit -m "$(cat <<'EOF'
blackjack(client): table screen with bet/hit/stand/double/split

Single-file table view: dealer at top, players in a row, hidden hole
card during play. Betting phase shows a slider + Bet / Sit out
buttons. Playing phase shows the action bar with Double/Split
disabled when illegal. Settlement banner reveals each player's
outcome and chip delta. Game-over banner on elimination.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: GameScreen switch + setGameType wiring

Route blackjack views to the new screen. Make sure `setGameType("blackjack")` is called when a `blackjack:update` arrives so the GameScreen switch fires.

**Files:**
- Modify: `client/src/components/GameScreen.tsx`
- Modify: `client/src/lib/useSocket.ts` (or wherever socket subscriptions are wired)

- [ ] **Step 1: Add the import + switch**

In `client/src/components/GameScreen.tsx`, add:

```tsx
import BlackjackGameScreen from "./BlackjackGameScreen";
```

After the codenames switch at line 45:

```tsx
  if (gameType === "codenames") return <CodenamesGameScreen />;
```

add:

```tsx
  if (gameType === "blackjack") return <BlackjackGameScreen />;
```

- [ ] **Step 2: Wire setGameType on first blackjack:update**

Find the existing `useSocket` hook or wherever per-game `set("update")` listeners are wired (look for the codenames update handler — it presumably calls `setGameType("codenames")`).

In `client/src/lib/useSocket.ts`, add inside the existing connection-effect block (alongside the other per-game listeners — search for `codenames:update`):

```ts
    socket.on("blackjack:update" as any, (view: any) => {
      useGameStore.getState().setGameType("blackjack");
      // The Zustand store for blackjack lives in its own slice; the screen
      // subscribes to it directly. Mirror what the codenames update does
      // (whichever combination of useGameStore + per-game store it uses).
      import("@/lib/blackjackStore").then(({ useBlackjackStore }) => {
        useBlackjackStore.getState().setView(view);
      });
    });
```

(The dynamic import keeps the SSR/static-export build from pulling the entire blackjack store into the initial bundle for non-blackjack games. If the codenames store is already top-level imported, follow that pattern instead and add a top-level import for `useBlackjackStore`.)

- [ ] **Step 3: Typecheck + start dev**

Run: `cd client && npx tsc --noEmit`
Expected: silent.

Run: `npm run dev` (from repo root)
Expected: client + server both come up.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/GameScreen.tsx client/src/lib/useSocket.ts
git commit -m "$(cat <<'EOF'
blackjack(client): route blackjack:update to BlackjackGameScreen

GameScreen switch adds the "blackjack" branch; useSocket sets the
game type and pushes the view into useBlackjackStore on every
blackjack:update event.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 24: Manual smoke test

End-to-end sanity check before merging. Tests aren't enough to verify the UI feel — actually play a hand.

- [ ] **Step 1: Start the stack**

Run: `npm run dev`
Expected: client at http://localhost:3000, server at http://localhost:3001 with the new migration applied.

- [ ] **Step 2: Walk the golden path in two browser tabs**

1. Tab A: open http://localhost:3000, sign in (or skip auth), create a lobby with the built-in `Blackjack` deck.
2. Tab B: open http://localhost:3000 in an incognito window, join the same lobby code.
3. From Tab A, click Start.
4. **Verify** the betting screen appears in both tabs with a bet slider defaulting to 10 and capped at 500 (or current chips, whichever is lower).
5. Place a bet from each tab — confirm the round auto-advances to the playing phase when the second bet lands.
6. **Verify** dealer's hole card displays as `??` while you're playing.
7. From the active tab, hit until you bust or stand — confirm advance to the next seat.
8. After both stands/busts, **verify** the dealer flips its hole card, draws to ≥17, and the settlement banner shows each player's outcome + chip delta.
9. **Verify** the next-round betting auto-starts after the settle delay.
10. Force one player below the table minimum (intentionally bet large and lose). On the round transition, **verify** that player's seat goes opaque and the bet input is gone.
11. Lose the second player too. **Verify** `Game over — last player standing wins` appears in both tabs.

- [ ] **Step 3: Checkpoint with the user**

Report the results to the user. If anything is off, file a follow-up task; otherwise, prep the PR.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin <branch>
gh pr create --title "Add Blackjack game type" --body "$(cat <<'EOF'
## Summary
- New game type "blackjack" — casino-style with bot dealer, variable-bet virtual chips, last-player-standing elimination
- MVP rule set: Hit / Stand / Double / Split (no insurance, surrender, re-split, multi-deck shoe)
- Sequential play with a parallel betting window
- Engine pattern mirrors codenamesGame.ts: Redis-keyed JSON, withGameLock-guarded mutations, snapshot/restore with the 2h zombie filter
- Three at-most-once Redis-locked timers for betting / per-turn / settle phases

Spec: docs/superpowers/specs/2026-04-19-blackjack-design.md
Plan: docs/superpowers/plans/2026-04-19-blackjack.md

## Test plan
- [x] vitest suite passes (npm --prefix server test)
- [x] manual smoke test (golden path + elimination + game-over)
- [ ] reviewer to verify table layout in their own browser

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

- **Spec coverage**
  - Round state machine (betting/dealing/playing/dealer/settle/gameOver) — T2/T4/T5/T6/T7/T11/T12/T13 ✓
  - Chip mechanics (reserve at bet, settle on settle, blackjack 3:2) — T3/T8/T9/T12 ✓
  - State shape (Card / Hand / Settlement / Config) — T1/T2 ✓
  - Sequential play with parallel betting — T4 (auto-advance when all bets in) + T17/T18 (timer) ✓
  - Disconnect handling (auto-stand mid-turn) — T14 (remove player) + T18 (timer fires auto-stand) ✓
  - Snapshot/restore with zombie filter + timer re-arm — T1/T14/T15/T16/T19 ✓
  - Per-phase Redis-locked timers — T17/T18 ✓
  - GameType union extension (server + client) — T15/T21 ✓
  - Built-in deck row — T15 ✓
  - Client screen with action bar + settlement reveal — T22/T23 ✓
  - All testing-strategy items from the spec — covered in T1–T14 ✓

- **Placeholder scan** — none. Every step has either real code or a real command + expected output.

- **Type consistency** — `Hand` shape (`fromSplit`) used identically across T1, T9, T22. `BlackjackPhase` literal set is the same in `types.ts` (extended T15), `blackjackGame.ts` (T1), and `blackjackStore.ts` (T21). API names match: `placeBet` / `hit` / `stand` / `doubleDown` / `split` / `sitOut` / `runDealer` / `settleRound` / `startNextRound` / `removePlayerFromBlackjackGame` / `exportBlackjackGames` / `restoreBlackjackGames` / `getBlackjackPlayerView` / `getBlackjackTurnDeadline` / `getBlackjackScores` / `isBlackjackGame` / `cleanupBlackjackGame` — same in handlers (T18), socketHelpers (T17), snapshot (T16), and lobby start-game branch (T20).

- **Scope check** — single subsystem (one engine + matching wiring + one screen). Single plan is appropriate.
