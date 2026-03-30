// In-memory presence tracking: maps authenticated users to their socket connections
// and tracks online/in-game status for the friends system.

import pool from "./db.js";

interface UserPresence {
  socketIds: Set<string>;
  status: "online" | "in_game";
  lobbyCode?: string;
  deckName?: string;
}

// userId -> presence state
const presenceMap = new Map<string, UserPresence>();
// socketId -> userId (reverse lookup)
const socketToUser = new Map<string, string>();

export function setOnline(userId: string, socketId: string): void {
  socketToUser.set(socketId, userId);
  const existing = presenceMap.get(userId);
  if (existing) {
    existing.socketIds.add(socketId);
  } else {
    presenceMap.set(userId, { socketIds: new Set([socketId]), status: "online" });
  }
}

export function setOffline(userId: string, socketId: string): boolean {
  socketToUser.delete(socketId);
  const presence = presenceMap.get(userId);
  if (!presence) return true;
  presence.socketIds.delete(socketId);
  if (presence.socketIds.size === 0) {
    presenceMap.delete(userId);
    // Update last_seen in DB (fire and forget)
    pool.query("UPDATE users SET last_seen = NOW() WHERE id = $1", [userId]).catch(() => {});
    return true; // fully offline
  }
  return false; // still has other connections
}

export function setInGame(userId: string, lobbyCode: string, deckName?: string): void {
  const presence = presenceMap.get(userId);
  if (presence) {
    presence.status = "in_game";
    presence.lobbyCode = lobbyCode;
    presence.deckName = deckName;
  }
}

export function setNotInGame(userId: string): void {
  const presence = presenceMap.get(userId);
  if (presence) {
    presence.status = "online";
    delete presence.lobbyCode;
    delete presence.deckName;
  }
}

export function getPresence(userId: string): { status: "online" | "in_game" | "offline"; lobbyCode?: string; deckName?: string } {
  const presence = presenceMap.get(userId);
  if (!presence) return { status: "offline" };
  return { status: presence.status, lobbyCode: presence.lobbyCode, deckName: presence.deckName };
}

export function getPresenceBulk(userIds: string[]): Map<string, { status: "online" | "in_game" | "offline"; lobbyCode?: string; deckName?: string }> {
  const result = new Map<string, { status: "online" | "in_game" | "offline"; lobbyCode?: string; deckName?: string }>();
  for (const id of userIds) {
    result.set(id, getPresence(id));
  }
  return result;
}

export function getUserIdForSocket(socketId: string): string | undefined {
  return socketToUser.get(socketId);
}

export function getSocketIdsForUser(userId: string): Set<string> {
  return presenceMap.get(userId)?.socketIds || new Set();
}

export function isOnline(userId: string): boolean {
  return presenceMap.has(userId);
}

export function remapSocket(oldSocketId: string, newSocketId: string): void {
  const userId = socketToUser.get(oldSocketId);
  if (!userId) return;
  socketToUser.delete(oldSocketId);
  socketToUser.set(newSocketId, userId);
  const presence = presenceMap.get(userId);
  if (presence) {
    presence.socketIds.delete(oldSocketId);
    presence.socketIds.add(newSocketId);
  }
}
