// Presence tracking: which users are online, which are in-game, and which
// sockets are associated with each user.
//
// Backed by Redis when REDIS_URL is set so every replica sees cluster-wide
// presence; falls back to local Maps otherwise. The socket → user reverse
// index lives in Redis too because stats recording needs to resolve socket
// IDs of players that may be connected to other replicas.

import { redis } from "./redis.js";
import pool from "./db.js";

type Status = "online" | "in_game" | "offline";

interface PresenceStatus {
  status: "online" | "in_game";
  lobbyCode?: string;
  deckName?: string;
}

const KEY_SOCKS = (userId: string) => `presence:socks:${userId}`;
const KEY_STATUS = (userId: string) => `presence:status:${userId}`;
const KEY_SOCK2USER = "presence:sock2user"; // hash socketId -> userId

// Local fallback when REDIS_URL is unset.
const localSocks = new Map<string, Set<string>>();
const localStatus = new Map<string, PresenceStatus>();
const localSock2User = new Map<string, string>();

export async function setOnline(userId: string, socketId: string): Promise<void> {
  if (redis) {
    const pipe = redis.pipeline();
    pipe.sadd(KEY_SOCKS(userId), socketId);
    pipe.hset(KEY_SOCK2USER, socketId, userId);
    // Only stamp "online" if no richer status exists (e.g., "in_game" from a
    // prior socket connection for the same user).
    pipe.hsetnx(KEY_STATUS(userId), "status", "online");
    await pipe.exec();
    return;
  }
  localSock2User.set(socketId, userId);
  let set = localSocks.get(userId);
  if (!set) {
    set = new Set();
    localSocks.set(userId, set);
  }
  set.add(socketId);
  if (!localStatus.has(userId)) {
    localStatus.set(userId, { status: "online" });
  }
}

export async function setOffline(userId: string, socketId: string): Promise<boolean> {
  if (redis) {
    const pipe = redis.pipeline();
    pipe.srem(KEY_SOCKS(userId), socketId);
    pipe.hdel(KEY_SOCK2USER, socketId);
    pipe.scard(KEY_SOCKS(userId));
    const results = await pipe.exec();
    const remaining = results ? (results[2][1] as number) : 0;
    if (remaining === 0) {
      await redis.del(KEY_STATUS(userId));
      pool.query("UPDATE users SET last_seen = NOW() WHERE id = $1", [userId]).catch(() => {});
      return true;
    }
    return false;
  }
  localSock2User.delete(socketId);
  const set = localSocks.get(userId);
  if (!set) return true;
  set.delete(socketId);
  if (set.size === 0) {
    localSocks.delete(userId);
    localStatus.delete(userId);
    pool.query("UPDATE users SET last_seen = NOW() WHERE id = $1", [userId]).catch(() => {});
    return true;
  }
  return false;
}

export async function setInGame(userId: string, lobbyCode: string, deckName?: string): Promise<void> {
  if (redis) {
    // Only upgrade status if the user is currently online — avoid creating
    // ghost "in_game" entries for logged-out users.
    const exists = await redis.exists(KEY_STATUS(userId));
    if (!exists) return;
    const pipe = redis.pipeline();
    pipe.hset(KEY_STATUS(userId), "status", "in_game");
    pipe.hset(KEY_STATUS(userId), "lobbyCode", lobbyCode);
    if (deckName) pipe.hset(KEY_STATUS(userId), "deckName", deckName);
    else pipe.hdel(KEY_STATUS(userId), "deckName");
    await pipe.exec();
    return;
  }
  const existing = localStatus.get(userId);
  if (!existing) return;
  existing.status = "in_game";
  existing.lobbyCode = lobbyCode;
  existing.deckName = deckName;
}

export async function setNotInGame(userId: string): Promise<void> {
  if (redis) {
    const exists = await redis.exists(KEY_STATUS(userId));
    if (!exists) return;
    const pipe = redis.pipeline();
    pipe.hset(KEY_STATUS(userId), "status", "online");
    pipe.hdel(KEY_STATUS(userId), "lobbyCode", "deckName");
    await pipe.exec();
    return;
  }
  const existing = localStatus.get(userId);
  if (!existing) return;
  existing.status = "online";
  delete existing.lobbyCode;
  delete existing.deckName;
}

export async function getPresence(userId: string): Promise<{ status: Status; lobbyCode?: string; deckName?: string }> {
  if (redis) {
    const h = await redis.hgetall(KEY_STATUS(userId));
    if (!h || Object.keys(h).length === 0) return { status: "offline" };
    return {
      status: (h.status as "online" | "in_game") || "online",
      lobbyCode: h.lobbyCode,
      deckName: h.deckName,
    };
  }
  const p = localStatus.get(userId);
  if (!p) return { status: "offline" };
  return { status: p.status, lobbyCode: p.lobbyCode, deckName: p.deckName };
}

export async function getPresenceBulk(
  userIds: string[]
): Promise<Map<string, { status: Status; lobbyCode?: string; deckName?: string }>> {
  const result = new Map<string, { status: Status; lobbyCode?: string; deckName?: string }>();
  if (userIds.length === 0) return result;
  if (redis) {
    const pipe = redis.pipeline();
    for (const id of userIds) pipe.hgetall(KEY_STATUS(id));
    const rows = (await pipe.exec()) || [];
    userIds.forEach((id, i) => {
      const h = (rows[i]?.[1] as Record<string, string>) || {};
      if (!h || Object.keys(h).length === 0) {
        result.set(id, { status: "offline" });
      } else {
        result.set(id, {
          status: (h.status as "online" | "in_game") || "online",
          lobbyCode: h.lobbyCode,
          deckName: h.deckName,
        });
      }
    });
    return result;
  }
  for (const id of userIds) {
    result.set(id, await getPresence(id));
  }
  return result;
}

export async function getUserIdForSocket(socketId: string): Promise<string | undefined> {
  if (redis) return (await redis.hget(KEY_SOCK2USER, socketId)) ?? undefined;
  return localSock2User.get(socketId);
}

export async function getSocketIdsForUser(userId: string): Promise<Set<string>> {
  if (redis) {
    const members = await redis.smembers(KEY_SOCKS(userId));
    return new Set(members);
  }
  return new Set(localSocks.get(userId) ?? []);
}

export async function isOnline(userId: string): Promise<boolean> {
  if (redis) return (await redis.exists(KEY_STATUS(userId))) === 1;
  return localStatus.has(userId);
}

export async function remapSocket(oldSocketId: string, newSocketId: string): Promise<void> {
  if (redis) {
    const userId = await redis.hget(KEY_SOCK2USER, oldSocketId);
    if (!userId) return;
    const pipe = redis.pipeline();
    pipe.hdel(KEY_SOCK2USER, oldSocketId);
    pipe.hset(KEY_SOCK2USER, newSocketId, userId);
    pipe.srem(KEY_SOCKS(userId), oldSocketId);
    pipe.sadd(KEY_SOCKS(userId), newSocketId);
    await pipe.exec();
    return;
  }
  const userId = localSock2User.get(oldSocketId);
  if (!userId) return;
  localSock2User.delete(oldSocketId);
  localSock2User.set(newSocketId, userId);
  const set = localSocks.get(userId);
  if (set) {
    set.delete(oldSocketId);
    set.add(newSocketId);
  }
}
