---
name: snapshot-roundtrip
description: Exercise the SIGTERM-snapshot-to-Postgres then restart-and-restore path end-to-end against a local server. Use when changes touch server/src/snapshot.ts or the shape of lobby/game/uno/codenames state, to catch shape drift that would silently break restore across a Railway deploy.
---

# Snapshot Roundtrip

Decked persists live lobby + game state to Postgres on SIGTERM and rehydrates it on next boot (`server/src/snapshot.ts`). When the shape of state changes, snapshots written by an old server can fail to restore on a new one — and because restore errors are swallowed, the symptom in prod is "lobbies vanished after deploy," not a loud crash. This skill runs a local roundtrip that would have caught the last three snapshot-related commits (`d6e6dbe`, `9f2d999`, `2f4efe0`).

## Prerequisites

- Local Postgres reachable via `DATABASE_URL` in `server/.env`
- Local Redis optional — the skill also works without Redis (in-memory fallback path)
- `server/` workspace built at least once (`npm --prefix server run build`) or run via `tsx`
- No other local server instance bound to `PORT`

## Steps

1. **Prep DB** — confirm the `snapshots` table exists (created by `db.ts` on boot). If not, start the server once and stop it cleanly.
2. **Boot fresh server** — `npm --prefix server run dev` in the background. Wait for `listening on :<port>`.
3. **Seed state** — via Socket.IO client or REST: create a lobby, add 2 players, start a game, play one round until a phase with an active timer (`phaseDeadline` in the future). Capture the lobby ID, game ID, current phase, and deadline.
4. **Trigger snapshot** — send `SIGTERM` to the server PID. Wait for graceful exit (the snapshot handler runs in the shutdown path). Do NOT send `SIGKILL`.
5. **Inspect the snapshot row** — query `SELECT kind, id, updated_at, state FROM snapshots ORDER BY updated_at DESC LIMIT 10;`. Verify the seeded lobby/game IDs are present and the JSON shape looks sane.
6. **Reboot server** — start again. Watch logs for `restored N lobbies / N games` and any restore errors (look for `snapshot restore failed`).
7. **Verify live state** — reconnect a client with the same `sessionId` cookies from step 3. Confirm:
   - Lobby still visible in the list
   - Players restored with correct hands (if CAH/Uno)
   - `phaseDeadline` obeys the 3-minute grace period from `9f2d999` (i.e., got pushed out far enough that a slow restart doesn't auto-advance the phase)
   - No zombie lobbies for games that shouldn't have survived (`2f4efe0`)
8. **Clean up** — truncate the `snapshots` table or delete the seeded lobby IDs.

## What to watch for

- **Shape drift**: JSON.parse errors during restore, or `TypeError: Cannot read properties of undefined` on a field a new version expects. Fix by adding a migration in the restore path, not by breaking old snapshots.
- **Timer double-fire**: on reboot both replicas can claim the same `phaseDeadline` lock; verify `socketHelpers.ts` still uses `SET NX` keyed to the deadline.
- **Zombie lobbies**: a lobby whose game should have been dropped on restore but wasn't (see `2f4efe0`). Check `dropZombie*` logic.

## Reporting

Return a short summary: which steps passed, which failed, and the exact diff in restored state vs. seeded state. If everything passed, confirm the snapshot row shape matches the current TypeScript types.
