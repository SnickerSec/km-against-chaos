// Shared Redis client. Null when REDIS_URL is unset (tests, local dev without
// Redis). Modules that need cross-replica state import this and check for
// null, falling back to in-memory behaviour when the client isn't available.

import { Redis } from "ioredis";
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
}
