import type { Server } from "socket.io";
import type { ClientEvents, ServerEvents } from "./types.js";
import { getPlayerView, getPlayerIds, getScores, getPhaseDeadline } from "./game.js";
import { getUnoPlayerView, getUnoPlayerIds, getUnoScores } from "./unoGame.js";
import { getCodenamesPlayerView } from "./codenamesGame.js";
import { getLobbyForSocket, getPlayerNameInLobby, getLobbyDeckId, getLobbyDeckName, getLobbyGameType, isPlayerBot, getActivePlayers, getLobbyPlayers } from "./lobby.js";
import { getUserIdForSocket } from "./presence.js";
import { recordGameResult } from "./statsStore.js";
import { createLogger } from "./logger.js";
import { redis } from "./redis.js";

const log = createLogger("game");

// ── Voice Chat State ────────────────────────────────────────────────────────

const voiceUsers = new Map<string, Set<string>>();

export function getVoiceUsers(code: string): Set<string> {
  if (!voiceUsers.has(code)) voiceUsers.set(code, new Set());
  return voiceUsers.get(code)!;
}

export function removeFromVoice(io: Server<ClientEvents, ServerEvents>, socketId: string) {
  for (const [code, users] of voiceUsers) {
    if (users.has(socketId)) {
      users.delete(socketId);
      io.to(code).emit("voice:user-left", socketId);
      if (users.size === 0) voiceUsers.delete(code);
      break;
    }
  }
}

// ── Chat History ─────────────────────────────────────────────────────────────
// Backed by Redis lists when REDIS_URL is set; falls back to a local Map for
// tests and single-replica dev without Redis. Messages are trimmed to the
// most recent 100 and the key expires after 24h so abandoned lobbies don't
// leave chat debris behind.

interface ChatMessage {
  id: string;
  playerName: string;
  text: string;
  gifUrl?: string;
  timestamp: number;
}

const CHAT_MAX = 100;
const CHAT_TTL_SECONDS = 24 * 60 * 60; // 24h
const CHAT_KEY_PREFIX = "chat:";
const chatKey = (code: string) => `${CHAT_KEY_PREFIX}${code}`;

const localChatHistory = new Map<string, ChatMessage[]>();

export async function addChatMessage(code: string, msg: ChatMessage): Promise<void> {
  if (redis) {
    const pipe = redis.pipeline();
    pipe.rpush(chatKey(code), JSON.stringify(msg));
    pipe.ltrim(chatKey(code), -CHAT_MAX, -1);
    pipe.expire(chatKey(code), CHAT_TTL_SECONDS);
    await pipe.exec();
    return;
  }
  let history = localChatHistory.get(code);
  if (!history) {
    history = [];
    localChatHistory.set(code, history);
  }
  history.push(msg);
  if (history.length > CHAT_MAX) history.shift();
}

export async function getChatHistory(code: string): Promise<ChatMessage[]> {
  if (redis) {
    const raw = await redis.lrange(chatKey(code), 0, -1);
    return raw.map(s => JSON.parse(s) as ChatMessage);
  }
  return localChatHistory.get(code) || [];
}

export async function clearChatHistory(code: string): Promise<void> {
  if (redis) {
    await redis.del(chatKey(code));
    return;
  }
  localChatHistory.delete(code);
}

export async function exportChatHistory(): Promise<Array<{ code: string; messages: ChatMessage[] }>> {
  if (redis) {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", `${CHAT_KEY_PREFIX}*`, "COUNT", 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
    const out: Array<{ code: string; messages: ChatMessage[] }> = [];
    for (const key of keys) {
      const raw = await redis.lrange(key, 0, -1);
      const messages = raw.map(s => JSON.parse(s) as ChatMessage);
      out.push({ code: key.slice(CHAT_KEY_PREFIX.length), messages });
    }
    return out;
  }
  return Array.from(localChatHistory.entries()).map(([code, messages]) => ({ code, messages }));
}

export async function restoreChatHistory(
  snapshots: Array<{ code: string; messages: ChatMessage[] }>
): Promise<void> {
  if (redis) {
    for (const s of snapshots) {
      if (s.messages.length === 0) continue;
      const pipe = redis.pipeline();
      pipe.del(chatKey(s.code));
      pipe.rpush(chatKey(s.code), ...s.messages.map(m => JSON.stringify(m)));
      pipe.expire(chatKey(s.code), CHAT_TTL_SECONDS);
      await pipe.exec();
    }
    return;
  }
  for (const s of snapshots) localChatHistory.set(s.code, s.messages);
}

// ── Broadcast Helpers ────────────────────────────────────────────────────────

export function sendRoundToPlayers(io: Server<ClientEvents, ServerEvents>, code: string) {
  const playerIds = getPlayerIds(code);
  for (const pid of playerIds) {
    const view = getPlayerView(code, pid);
    if (view) io.to(pid).emit("game:round-start", view);
  }
}

export function sendUnoTurnToPlayers(io: Server<ClientEvents, ServerEvents>, code: string) {
  const playerIds = getUnoPlayerIds(code);
  for (const pid of playerIds) {
    const view = getUnoPlayerView(code, pid);
    if (view) io.to(pid).emit("uno:turn-update", view);
  }
}

export async function sendCodenamesUpdate(io: Server<ClientEvents, ServerEvents>, code: string) {
  const players = await getLobbyPlayers(code);
  if (!players) return;
  for (const pid of players) {
    const view = await getCodenamesPlayerView(code, pid);
    if (view) {
      const playerSocket = io.sockets.sockets.get(pid);
      if (playerSocket) playerSocket.emit("codenames:update" as any, view);
    }
  }
}

// ── Lookup Aliases ───────────────────────────────────────────────────────────

export async function findPlayerLobby(socketId: string): Promise<string | undefined> {
  return getLobbyForSocket(socketId);
}

export async function getPlayerName(code: string, playerId: string): Promise<string | undefined> {
  return getPlayerNameInLobby(code, playerId);
}

// ── CAH Round Timers ─────────────────────────────────────────────────────────

const roundTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleRoundTimer(code: string, onExpiry: (code: string) => void) {
  clearRoundTimer(code);
  const deadline = getPhaseDeadline(code);
  if (!deadline) return;
  const delay = Math.max(0, deadline - Date.now());
  roundTimers.set(code, setTimeout(() => {
    roundTimers.delete(code);
    onExpiry(code);
  }, delay));
}

export function clearRoundTimer(code: string) {
  const existing = roundTimers.get(code);
  if (existing) {
    clearTimeout(existing);
    roundTimers.delete(code);
  }
}

// ── Uno Turn Timers ──────────────────────────────────────────────────────────

const TURN_TIMER_MS = 30_000;
const unoTurnTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleUnoTurnTimer(code: string, onExpiry: (code: string) => void) {
  clearUnoTurnTimer(code);
  unoTurnTimers.set(code, setTimeout(() => {
    unoTurnTimers.delete(code);
    onExpiry(code);
  }, TURN_TIMER_MS));
}

export function clearUnoTurnTimer(code: string) {
  const t = unoTurnTimers.get(code);
  if (t) { clearTimeout(t); unoTurnTimers.delete(code); }
}

// ── Game Result Recording ────────────────────────────────────────────────────

export async function recordCahGameResult(code: string, scores: Record<string, number>) {
  try {
    const playerIds = (await getActivePlayers(code)) || [];
    const topEntry = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const winnerId = topEntry?.[0];
    const players = await Promise.all(playerIds.map(async pid => ({
      userId: (await getUserIdForSocket(pid)) || null,
      name: (await getPlayerNameInLobby(code, pid)) || pid,
      score: scores[pid] || 0,
      isWinner: pid === winnerId,
      isBot: await isPlayerBot(code, pid),
    })));
    recordGameResult({
      lobbyCode: code,
      deckId: (await getLobbyDeckId(code)) || null,
      deckName: (await getLobbyDeckName(code)) || "Unknown",
      gameType: (await getLobbyGameType(code)) || "cah",
      playerCount: players.filter(p => !p.isBot).length,
      roundsPlayed: 0,
      players,
    }).catch(e => log.error("failed to record game", { error: String(e) }));
  } catch {}
}

export async function recordUnoGameResult(code: string, scores: Record<string, number>) {
  try {
    const playerIds = (await getActivePlayers(code)) || [];
    const topEntry = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const winnerId = topEntry?.[0];
    const players = await Promise.all(playerIds.map(async pid => ({
      userId: (await getUserIdForSocket(pid)) || null,
      name: (await getPlayerNameInLobby(code, pid)) || pid,
      score: scores[pid] || 0,
      isWinner: pid === winnerId,
      isBot: await isPlayerBot(code, pid),
    })));
    recordGameResult({
      lobbyCode: code,
      deckId: (await getLobbyDeckId(code)) || null,
      deckName: (await getLobbyDeckName(code)) || "Unknown",
      gameType: (await getLobbyGameType(code)) || "uno",
      playerCount: players.filter(p => !p.isBot).length,
      roundsPlayed: 0,
      players,
    }).catch(e => log.error("failed to record Uno game", { error: String(e) }));
  } catch {}
}

// ── Allowed Media Hosts ──────────────────────────────────────────────────────

const ALLOWED_MEDIA_HOSTS = [
  "media.giphy.com", "media0.giphy.com", "media1.giphy.com", "media2.giphy.com",
  "media3.giphy.com", "media4.giphy.com", "media.tenor.com", "c.tenor.com", "static.klipy.com",
];

export function isAllowedMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      ALLOWED_MEDIA_HOSTS.some(h => parsed.hostname === h);
  } catch {
    return false;
  }
}
