// Session management: maps persistent session IDs to transient socket IDs
// so players can reconnect after a page refresh within a grace period.
//
// Backed by Redis when REDIS_URL is set (multi-replica safe) and by local
// Maps otherwise (tests, single-replica dev). Disconnect timers always stay
// local — setTimeout handles can't be serialised across replicas. If a
// player disconnects on replica A and reconnects on replica B, the timer on
// A will fire and run cleanup against the shared Redis state, which is
// idempotent.

import { redis } from "./redis.js";

const GRACE_PERIOD_MS = 120_000; // 2 minutes — mobile browsers kill sockets when backgrounded

const KEY_S2SOCK = "sessions:s2sock"; // hash sessionId -> socketId
const KEY_SOCK2S = "sessions:sock2s"; // hash socketId -> sessionId

// Local fallback when REDIS_URL is unset.
const localS2Sock = new Map<string, string>();
const localSock2S = new Map<string, string>();

// Disconnect timers are always local — they hold setTimeout handles.
const disconnectTimers = new Map<string, NodeJS.Timeout>();

export async function registerSession(
  sessionId: string,
  socketId: string
): Promise<{ isReconnect: boolean; oldSocketId: string | null }> {
  const oldSocketId = (await hget(KEY_S2SOCK, sessionId)) ?? null;
  const isReconnect = oldSocketId !== null && oldSocketId !== socketId;

  // Clean up the old socket -> session mapping, if any.
  if (oldSocketId) {
    await hdel(KEY_SOCK2S, oldSocketId);
  }

  await hset(KEY_S2SOCK, sessionId, socketId);
  await hset(KEY_SOCK2S, socketId, sessionId);

  return { isReconnect, oldSocketId };
}

export async function unregisterSocket(socketId: string): Promise<string | undefined> {
  return (await hget(KEY_SOCK2S, socketId)) ?? undefined;
}

export async function getSocketId(sessionId: string): Promise<string | undefined> {
  return (await hget(KEY_S2SOCK, sessionId)) ?? undefined;
}

export async function getSessionId(socketId: string): Promise<string | undefined> {
  return (await hget(KEY_SOCK2S, socketId)) ?? undefined;
}

export function startDisconnectTimer(
  sessionId: string,
  callback: () => void,
  delayMs: number = GRACE_PERIOD_MS
): void {
  cancelDisconnectTimer(sessionId);
  const timer = setTimeout(() => {
    disconnectTimers.delete(sessionId);
    callback();
  }, delayMs);
  disconnectTimers.set(sessionId, timer);
}

export function cancelDisconnectTimer(sessionId: string): boolean {
  const timer = disconnectTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(sessionId);
    return true;
  }
  return false;
}

export async function cleanupSession(sessionId: string): Promise<void> {
  const socketId = await hget(KEY_S2SOCK, sessionId);
  if (socketId) {
    await hdel(KEY_SOCK2S, socketId);
  }
  await hdel(KEY_S2SOCK, sessionId);
  cancelDisconnectTimer(sessionId);
}

// ── KV helpers — Redis when available, local Maps otherwise ──────────────────

async function hget(key: string, field: string): Promise<string | null> {
  if (redis) return redis.hget(key, field);
  const map = localMapFor(key);
  return map.get(field) ?? null;
}

async function hset(key: string, field: string, value: string): Promise<void> {
  if (redis) {
    await redis.hset(key, field, value);
    return;
  }
  localMapFor(key).set(field, value);
}

async function hdel(key: string, field: string): Promise<void> {
  if (redis) {
    await redis.hdel(key, field);
    return;
  }
  localMapFor(key).delete(field);
}

function localMapFor(key: string): Map<string, string> {
  if (key === KEY_S2SOCK) return localS2Sock;
  if (key === KEY_SOCK2S) return localSock2S;
  throw new Error(`unknown local map key: ${key}`);
}
