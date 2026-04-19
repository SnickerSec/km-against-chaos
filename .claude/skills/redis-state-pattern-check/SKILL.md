---
name: redis-state-pattern-check
description: Invariants the Decked server must uphold for multi-replica correctness — load→mutate→save, Redis-keyed at-most-once timers, websocket-only transport. Use whenever editing any state module under server/src/ (lobby.ts, game.ts, unoGame.ts, codenamesGame.ts, sessions.ts, presence.ts, snapshot.ts) or any handler under server/src/handlers/.
disable-model-invocation: false
---

# Redis State Pattern Check

Decked runs **2 Railway replicas** sharing state via Redis + `@socket.io/redis-adapter`. The following invariants hold across the entire `server/src/` tree. Breaking any of them is how multi-replica bugs ship — and they are all invisible in a single-replica dev environment.

## Invariant 1 — All state mutation is load → mutate → save

Every public mutation in `lobby.ts`, `game.ts`, `unoGame.ts`, `codenamesGame.ts`, `sessions.ts`, `presence.ts`, and the chat-history helpers in `socketHelpers.ts` must:

1. `load` the current blob from Redis (or the in-memory fallback if `REDIS_URL` is unset)
2. mutate in memory
3. `save` the blob back

**Never** keep module-level `Map`/`Set`/`Array` as the source of truth for game state. The only acceptable module-level singletons are: the Redis client itself, the in-memory fallback `Map` used _only_ when `REDIS_URL` is unset, and stateless helpers.

Check: grep for `new Map(` / `new Set(` at module scope in any file under `server/src/`. If the state outlives a single request and is not a `REDIS_URL`-gated fallback, it's a bug.

## Invariant 2 — Timers are at-most-once via `SET NX` locks keyed to the deadline

Round/turn/phase timers in `socketHelpers.ts` and anywhere that uses `setTimeout` to advance game state must claim a Redis lock keyed to the exact `phaseDeadline` timestamp before running. If the lock is already held (because the other replica's timer fired first), the callback must be a no-op. See commit `b82557c` for the canonical pattern.

Check: any `setTimeout` / `setInterval` callback that mutates game state must be wrapped in an `acquirePhaseLock(gameId, phaseDeadline)`-shaped call. Raw `setTimeout(() => advancePhase(...))` is a bug.

## Invariant 3 — All state-module public APIs are async

Because load/save hits Redis, every public function in the state modules returns a `Promise`. Synchronous signatures are a smell — they either lie about being synchronous or they bypass Redis.

Check: new exports in those files should be `async`. Callers should `await` them.

## Invariant 4 — WebSocket-only transport; sticky-by-construction

Client Socket.IO is configured with `transports: ["websocket"]` (polling disabled). This makes each client stick to one replica for the lifetime of the connection. Cross-replica broadcasts go through the Redis adapter. Code that assumes "the room is local to this replica" is wrong for broadcasts but correct for direct socket writes.

Check: never downgrade or add `polling` to the client transport list. Never call `io.to(room).emit(...)` and then immediately read local state expecting the emit to have reached other replicas — it's async through Redis.

## Invariant 5 — Snapshot-restore must tolerate shape drift

`server/src/snapshot.ts` loads old JSON blobs written by a previous deploy. When you add a required field to lobby/game state, give it a default during restore. When you remove a field, ignore it on restore. The restore path is the only place where type safety has to be defensive — everything else can trust the current shape.

## When this skill applies

- Editing any file in `server/src/` whose name is in the list above
- Editing any file under `server/src/handlers/`
- Adding a new game mode (it will need its own state module following the same rules)
- Changing timer or phase-advance logic
- Touching `snapshot.ts`

## When this skill does not apply

- Client-side code (no Redis, no replicas)
- REST routes that don't touch live game state (`deckRoutes.ts`, `authRoutes.ts`, etc., except when they cross into the state modules)
- Test files under `server/src/__tests__/` (they're single-process by design)
