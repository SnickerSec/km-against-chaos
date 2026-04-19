// Shared Redis client. Null when REDIS_URL is unset (tests, local dev without
// Redis). Modules that need cross-replica state import this and check for
// null, falling back to in-memory behaviour when the client isn't available.

import { Redis } from "ioredis";
import { randomUUID } from "crypto";
import { createLogger } from "./logger.js";

const log = createLogger("redis");

export const redis: Redis | null = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      // Short connect timeout so a broken Redis doesn't block server startup.
      connectTimeout: 5_000,
      // Don't queue commands while disconnected — fail fast so callers can
      // fall back or log, rather than hanging requests silently.
      maxRetriesPerRequest: 2,
    })
  : null;

if (redis) {
  redis.on("error", (err) => {
    log.error("redis connection error", { error: String(err) });
  });
  redis.on("connect", () => log.info("redis connected"));

  // Atomic check-and-delete for releasing a per-game mutex: only delete if the
  // value still equals the lock id we wrote (i.e., we still own it). Prevents
  // accidentally releasing a lock another replica took after our TTL expired.
  redis.defineCommand("releaseGameLock", {
    numberOfKeys: 1,
    lua: `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `,
  });
}

// ── Per-game distributed mutex ───────────────────────────────────────────────
// Serializes load-mutate-save sequences for one game state across replicas so
// concurrent mutations don't clobber each other (last-writer-wins).
//
// No-op when redis is null: single-replica/in-memory mode has no cross-replica
// race surface, and the in-process event loop already serializes JS mutations.
//
// TTL is short (5s) so a crashed replica's lock auto-releases.

const LOCK_TTL_SECONDS = 5;
const LOCK_POLL_MS = 25;
const LOCK_MAX_WAIT_MS = 5_000;

export type GameLockNamespace = "cah" | "uno" | "codenames" | "lobby";

export async function withGameLock<T>(
  ns: GameLockNamespace,
  code: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!redis) return fn();

  const key = `mutex:${ns}:${code}`;
  const id = randomUUID();
  const start = Date.now();

  while (true) {
    const ok = await redis.set(key, id, "EX", LOCK_TTL_SECONDS, "NX");
    if (ok === "OK") break;
    if (Date.now() - start >= LOCK_MAX_WAIT_MS) {
      throw new Error(`withGameLock: timed out acquiring ${key} after ${LOCK_MAX_WAIT_MS}ms`);
    }
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
  }

  try {
    return await fn();
  } finally {
    try {
      await (redis as Redis & { releaseGameLock: (key: string, id: string) => Promise<number> })
        .releaseGameLock(key, id);
    } catch (err) {
      log.error("withGameLock release failed", { key, error: String(err) });
    }
  }
}
