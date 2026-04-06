import type { Server } from "socket.io";
import type { ClientEvents, ServerEvents } from "./types.js";
import { getPlayerView, getPlayerIds, getScores, getPhaseDeadline } from "./game.js";
import { getUnoPlayerView, getUnoPlayerIds, getUnoScores } from "./unoGame.js";
import { getCodenamesPlayerView } from "./codenamesGame.js";
import { getLobbyForSocket, getPlayerNameInLobby, getLobbyDeckId, getLobbyDeckName, getLobbyGameType, isPlayerBot, getActivePlayers, getLobbyPlayers } from "./lobby.js";
import { getUserIdForSocket } from "./presence.js";
import { recordGameResult } from "./statsStore.js";
import { createLogger } from "./logger.js";

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

interface ChatMessage {
  id: string;
  playerName: string;
  text: string;
  gifUrl?: string;
  timestamp: number;
}

const chatHistory = new Map<string, ChatMessage[]>();

export function addChatMessage(code: string, msg: ChatMessage) {
  let history = chatHistory.get(code);
  if (!history) {
    history = [];
    chatHistory.set(code, history);
  }
  history.push(msg);
  if (history.length > 100) history.shift();
}

export function getChatHistory(code: string): ChatMessage[] {
  return chatHistory.get(code) || [];
}

export function clearChatHistory(code: string) {
  chatHistory.delete(code);
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

export function sendCodenamesUpdate(io: Server<ClientEvents, ServerEvents>, code: string) {
  const players = getLobbyPlayers(code);
  if (!players) return;
  for (const pid of players) {
    const view = getCodenamesPlayerView(code, pid);
    if (view) {
      const playerSocket = io.sockets.sockets.get(pid);
      if (playerSocket) playerSocket.emit("codenames:update" as any, view);
    }
  }
}

// ── Lookup Aliases ───────────────────────────────────────────────────────────

export function findPlayerLobby(socketId: string): string | undefined {
  return getLobbyForSocket(socketId);
}

export function getPlayerName(code: string, playerId: string): string | undefined {
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

export function recordCahGameResult(code: string, scores: Record<string, number>) {
  try {
    const playerIds = getActivePlayers(code) || [];
    const topEntry = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const winnerId = topEntry?.[0];
    const players = playerIds.map(pid => ({
      userId: getUserIdForSocket(pid) || null,
      name: getPlayerNameInLobby(code, pid) || pid,
      score: scores[pid] || 0,
      isWinner: pid === winnerId,
      isBot: isPlayerBot(code, pid),
    }));
    recordGameResult({
      lobbyCode: code,
      deckId: getLobbyDeckId(code) || null,
      deckName: getLobbyDeckName(code) || "Unknown",
      gameType: getLobbyGameType(code) || "cah",
      playerCount: players.filter(p => !p.isBot).length,
      roundsPlayed: 0,
      players,
    }).catch(e => log.error("failed to record game", { error: String(e) }));
  } catch {}
}

export function recordUnoGameResult(code: string, scores: Record<string, number>) {
  try {
    const playerIds = getActivePlayers(code) || [];
    const topEntry = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const winnerId = topEntry?.[0];
    const players = playerIds.map(pid => ({
      userId: getUserIdForSocket(pid) || null,
      name: getPlayerNameInLobby(code, pid) || pid,
      score: scores[pid] || 0,
      isWinner: pid === winnerId,
      isBot: isPlayerBot(code, pid),
    }));
    recordGameResult({
      lobbyCode: code,
      deckId: getLobbyDeckId(code) || null,
      deckName: getLobbyDeckName(code) || "Unknown",
      gameType: getLobbyGameType(code) || "uno",
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
