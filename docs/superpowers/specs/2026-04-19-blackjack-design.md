# Blackjack — Design Spec

**Date:** 2026-04-19
**Status:** Approved for implementation planning
**Owner:** Chuck

## Goal

Add a fourth game type, `blackjack`, alongside CAH, Uno, and Codenames. Casino-style multiplayer blackjack with a bot dealer, variable-bet virtual chips scoped to the lobby session, and a last-player-standing elimination loop. MVP rule set: Hit / Stand / Double Down / Split.

## Decisions made during brainstorming

| # | Decision | Choice |
|---|----------|--------|
| 1 | Player/dealer model | Casino-style with bot dealer; 1–N humans at the same table |
| 2 | Betting model | Variable-bet virtual chips, balance scoped to the lobby (no cross-session persistence) |
| 3 | Rule set | Standard casino: Hit, Stand, Double Down, Split. **Excluded** for MVP: insurance, surrender, multi-deck shoe, re-split |
| 4 | Game-end condition | Last-player-standing elimination |
| 5 | Round timing | Sequential play with parallel betting window |
| 6 | Shoe representation | Persist the shoe array directly in snapshot state (not RNG-seed replay) |

## Round state machine

Each lobby has at most one `InternalBlackjackGame` keyed at `blackjack:{lobbyCode}` in Redis. Phases:

1. **`betting`** — every still-funded player submits a bet within `BETTING_WINDOW_MS` (default 15s). Round advances when all in-funded players have submitted *or* the timer fires. Players who never submit get auto-bet at the table minimum unless they explicitly chose `Sit out` for the round.
2. **`dealing`** — server deals two cards to each player and the dealer (dealer's hole card face-down). No player input.
3. **`playing`** — sequential. Engine sets `activePlayerIndex = 0`, `activeHandIndex = 0`. Active player can `Hit` / `Stand` / `Double` / `Split` (last two only when legal). Hand-bust ends that hand. When the active hand is done, advance `activeHandIndex`; when all of a player's hands are done, advance `activePlayerIndex`. Per-player turn timer (`TURN_TIME_MS`, default 30s) auto-Stands on expiry.
4. **`dealer`** — server flips hole card; dealer hits to ≥17 (stands on all 17). Sent as one update with the full draw sequence so the client can animate it. Skip-dealer optimisation: no draws if every player busted.
5. **`settle`** — engine compares each non-busted hand to dealer's total, mutates each player's chip balance, sets `gameOver` if `playersStillEligible.length <= 1`, otherwise auto-loops to `betting` after `SETTLE_DELAY_MS` (default 5s). A player is **eligible** when `chips >= MIN_BET`; once their balance drops below the table minimum they're eliminated (cannot afford another hand). This is the operational definition of "last player standing".

`gameOver` is the terminal phase. The engine emits `game:over` with final standings (chips per player), mirroring `game.ts` and `codenamesGame.ts`.

### Chip mechanics

Bets are **reserved at bet placement** — `chips[playerId]` is decremented by the bet amount when `placeBet` succeeds, and the bet sits on the hand. On `settle` the chip delta is paid back according to outcome:

| Outcome     | `delta`                       | Net chip change vs pre-bet balance |
|-------------|-------------------------------|------------------------------------|
| `win`       | `+2 × bet`                    | `+bet`                             |
| `blackjack` | `+bet + ceil(1.5 × bet)`      | `+ceil(1.5 × bet)`                 |
| `push`      | `+bet`                        | `0`                                |
| `lose`      | `0`                           | `−bet`                             |

`Double` deducts a second bet-equivalent at action time; `Split` deducts a second bet at action time and creates the second hand. Both follow the same reserve-then-settle model.

## State shape

```ts
interface InternalBlackjackGame {
  lobbyCode: string;
  shoe: Card[];                                  // remaining cards (top = end of array, popped)
  playerIds: string[];                           // seat order, set at create, never reshuffled
  chips: Record<string, number>;                 // current chip balance per player
  config: { startingChips: number; minBet: number; maxBet: number };
  phase: "betting" | "dealing" | "playing" | "dealer" | "settle" | "gameOver";
  bets: Record<string, number | "sitting_out" | null>;  // null = bet not yet placed
  hands: Record<string, Hand[]>;                 // each player normally 1 hand, 2 after split
  dealerHand: Card[];                            // hole card index = 1 (0 is up-card)
  activePlayerIndex: number;
  activeHandIndex: number;
  phaseDeadline: number;                         // epoch ms — keys the at-most-once timer lock
  roundNumber: number;
  lastSettlement?: Settlement[];                 // last round's outcomes, kept for the post-settle reveal
  createdAt: number;                             // epoch ms — zombie-restore filter
}

interface Card { suit: "S" | "H" | "D" | "C"; rank: "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" }
interface Hand { cards: Card[]; bet: number; doubled: boolean; resolved: boolean }
interface Settlement { playerId: string; handIndex: number; outcome: "win" | "lose" | "push" | "blackjack"; delta: number }
```

`getBlackjackPlayerView(code, playerId)` returns the same shape but with the dealer's hole card hidden during `playing` (`{rank: "?", suit: "?"}`) and revealed in `dealer`/`settle`/`gameOver`. Other players' hands and chip totals are always visible — it's a public table.

The shoe is reshuffled every hand from a fresh 52-card deck (single-deck-reshuffled). Multi-deck shoe is a follow-up.

## Files

### New on the server

- `server/src/blackjackGame.ts` — engine. Mirrors `codenamesGame.ts` structure: `InternalBlackjackGame` interface, `loadGame`/`saveGame` helpers, every public mutation wrapped in `withGameLock("blackjack", code, ...)`. Public API: `createBlackjackGame`, `getBlackjackPlayerView`, `placeBet`, `hit`, `stand`, `double`, `split`, `sitOut`, `cleanupBlackjackGame`, `removePlayerFromBlackjackGame`, `exportBlackjackGames`, `restoreBlackjackGames`, `isBlackjackGame`.
- `server/src/handlers/blackjackHandlers.ts` — socket events `blackjack:bet`, `blackjack:hit`, `blackjack:stand`, `blackjack:double`, `blackjack:split`, `blackjack:sit-out`. Same shape as `codenamesHandlers.ts`: callback-acked, broadcasts via `sendBlackjackUpdate(io, code)` after each mutation.
- `server/src/__tests__/blackjackGame.test.ts` — vitest suite. Same fixtures pattern as `codenamesGame.test.ts`. Stubs `game.shoe` to make rule tests deterministic.

### New on the client

- `client/src/components/BlackjackGameScreen.tsx` — table view: dealer at top, players around, betting chips, action bar (Hit/Stand/Double/Split). Subscribes to `blackjack:update`.
- `client/src/lib/blackjackStore.ts` — Zustand slice for current game state.

### Modified

- `server/src/types.ts` — add `"blackjack"` to the `GameType` union (around line 57).
- `server/src/deckStore.ts` — extend the card-validation skip to `gameType === "blackjack"` (around line 114, alongside the existing Uno skip).
- `server/src/handlers/lobbyHandlers.ts` — add a `gameType === "blackjack"` branch in the start-game flow that calls `createBlackjackGame(code, playerIds, { startingChips, minBet, maxBet })`.
- `server/src/index.ts` — register `blackjackHandlers`.
- `server/src/snapshot.ts` — add `blackjack_game_snapshots` integration: export on SIGTERM; restore from rows newer than 15min; skip games whose `createdAt` is >2h old (zombie filter); bump `phaseDeadline` on restore.
- `server/src/db.ts` — schema-init for the new `blackjack_game_snapshots` table; insert one built-in deck row at boot (`name: "Blackjack"`, `gameType: "blackjack"`, `built_in: TRUE`, `owner_id: NULL`, no cards) via `INSERT ... ON CONFLICT DO NOTHING`.
- `client/src/components/GameScreen.tsx` — add `if (gameType === "blackjack") return <BlackjackGameScreen />` to the switch.

**Net file count:** 5 new (3 server, 2 client) + 7 modified.

## Timers and locks

Per-phase Redis-locked timers, same `socketHelpers.ts` pattern as CAH/Uno (commit b82557c). Lock is `SET NX` keyed to `phaseDeadline` so a duplicate fire on the other replica is dropped.

| Phase    | Timer key                                         | TTL              | On expiry                                                       |
|----------|---------------------------------------------------|------------------|-----------------------------------------------------------------|
| betting  | `bj:timer:{code}:bet:{phaseDeadline}`             | `BETTING_WINDOW_MS` | Auto-bet table min for any player who didn't submit          |
| playing  | `bj:timer:{code}:turn:{playerId}:{phaseDeadline}` | `TURN_TIME_MS`   | Auto-Stand the current hand; advance                            |
| settle   | `bj:timer:{code}:settle:{phaseDeadline}`          | `SETTLE_DELAY_MS`| Loop back to `betting`, or end the game if only one funded player remains |

## Error handling and validation

Every socket event re-loads game state inside `withGameLock` and validates: phase matches, sender is the active player (where applicable), action is legal at this position (e.g. `Double` only on a 2-card hand; `Split` only on a pair and only if the player has chips for the second bet). Failures return `{ success: false, error }` to the caller — no broadcast, no state change. Illegal actions surface as a client-side toast; no silent failures.

## Disconnect behaviour

- **Mid-betting**: treat as bet-not-submitted; auto-bet at table min when window closes. Reconnecting within the window preserves a submitted bet.
- **Mid-playing on someone else's turn**: nothing happens; reconnect picks up live state from `getBlackjackPlayerView`.
- **Mid-playing on own turn**: turn timer expires → auto-Stand → advance. No grace extension; keep the round moving.
- **Permanent leave (lobby:leave)**: `removePlayerFromBlackjackGame` — chip balance forfeited, any in-flight hand auto-Stands, `playerIds` filtered. If the active player leaves, advance immediately. If only one funded player remains, end the game.

## Bust-out spectator UI

When a player's chips drop below `MIN_BET` during `settle`, they're eliminated for the rest of the game. Their seat shows greyed-out, no betting prompt, no actions — they just watch the rest. Reuses the existing "you are not the active player" UI state on the client; just no betting input either.

## Snapshot / restore

- `exportBlackjackGames()` collects every `blackjack:*` Redis key.
- `snapshot.ts` writes them to a new `blackjack_game_snapshots` Postgres table on SIGTERM.
- `restoreBlackjackGames()` reads rows newer than 15min (existing snapshot-table cutoff in `snapshot.ts`) and skips games whose `createdAt` is >2h old (codenames-style zombie filter — blackjack has no single per-round deadline that's a clean staleness signal).
- `phaseDeadline` is bumped on restore (`Date.now() + remaining-phase-time`); the 3-min grace already in place from commit 9f2d999 covers boot.

## Configuration defaults

| Constant            | Default     | Notes                              |
|---------------------|-------------|------------------------------------|
| `STARTING_CHIPS`    | 1000        | Per-player chip pool at game start |
| `MIN_BET`           | 10          | Table minimum                      |
| `MAX_BET`           | 500         | Table maximum                      |
| `BETTING_WINDOW_MS` | 15_000      | Parallel betting phase cap         |
| `TURN_TIME_MS`      | 30_000      | Per-player turn timer              |
| `SETTLE_DELAY_MS`   | 5_000       | Reveal pause before next round     |
| `BLACKJACK_PAYOUT`  | 3:2         | Player-blackjack pays 1.5× the bet |
| `ABANDONED_GAME_AGE_MS` | 2 hours | Zombie-restore filter              |

These live as `const` exports at the top of `blackjackGame.ts`; not configurable per lobby in MVP.

## Testing

Vitest suite mirrors `codenamesGame.test.ts`. Stubbing `game.shoe = [...]` directly before action tests gives deterministic outcomes — same pattern as the existing snapshot round-trip tests that mutate exported state.

Coverage targets (one `describe` block each):

- **`createBlackjackGame`** — initial state shape, every player gets `STARTING_CHIPS`, no cards dealt yet, phase is `betting`.
- **`placeBet`** — happy path; rejects below min / above max / above current chips / wrong phase / sitting-out player; auto-advances when last bet lands.
- **Betting timer** — fires after `BETTING_WINDOW_MS`, missing bets default to min, lock-key idempotency.
- **`hit`** — adds a card, busts at >21 with `resolved=true` and chips already deducted; rejects when not active player / wrong phase.
- **`stand`** — advances `activeHandIndex`, then `activePlayerIndex`, then to `dealer` phase.
- **`double`** — only legal on a 2-card hand with chips; deals exactly one more card, doubles the bet, marks `doubled=true`, auto-stands.
- **`split`** — only legal on a pair (and only if `chips >= bet`); creates two hands each with the original bet; second hand draws one card before play. Edge: split-aces gets exactly one card per hand and auto-stands. Edge: re-split is rejected — once a hand has been split, neither resulting hand may be split again, even if it draws into another pair (MVP rule).
- **Dealer play** — hits to ≥17, stands on all 17, busts correctly, skips drawing if every player busted.
- **Settlement** — every win/lose/push/blackjack outcome and chip delta; blackjack pays 3:2; player-blackjack vs dealer-blackjack pushes; busted player loses regardless of dealer.
- **Game-over** — last-player-standing emits the right `Settlement[]`; game won't auto-loop after only one player has chips.
- **`removePlayerFromBlackjackGame`** — mid-round leave during own turn auto-stands and advances; leaving when only one eligible player (`chips >= MIN_BET`) remains ends the game.
- **`exportBlackjackGames` / `restoreBlackjackGames`** — round-trip preserves shoe / hands / chips / phase; restore skips zombie games >2h old; restore re-bumps `phaseDeadline`.

**Out of test scope:** Socket handler integration (handlers are thin wrappers; covered by manual play). UI/visual tests (no test infra for the client today). Concurrent multi-replica race tests (the Redis lock is the contract; the existing `withGameLock` tests cover that primitive).

## Out of scope (follow-ups)

- Insurance and surrender
- Multi-deck shoe and configurable reshuffle threshold
- Re-split (>1 split per round)
- Cross-session chip persistence (account-bound bankroll)
- Configurable house rules per lobby (S17 vs H17, BJ payout, max bet)
- Tournament leaderboard mode
- Spectator-only seats
- Card-counting deterrents (CSM, mid-shoe shuffle)
