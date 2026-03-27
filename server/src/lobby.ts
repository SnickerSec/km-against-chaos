import { randomBytes } from "crypto";
import type { Lobby, Player, LobbyState, PlayerInfo } from "./types.js";

const lobbies = new Map<string, Lobby>();
const playerLobby = new Map<string, string>(); // socketId -> lobbyCode

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O to avoid confusion
  let code: string;
  do {
    code = Array.from({ length: 4 }, () =>
      chars[randomBytes(1)[0] % chars.length]
    ).join("");
  } while (lobbies.has(code));
  return code;
}

function lobbyToState(lobby: Lobby): LobbyState {
  return {
    code: lobby.code,
    players: Array.from(lobby.players.values()).map(playerToInfo),
    hostId: lobby.hostId,
    deckId: lobby.deckId,
    deckName: lobby.deckName,
    status: lobby.status,
  };
}

function playerToInfo(player: Player): PlayerInfo {
  return {
    id: player.id,
    name: player.name,
    isHost: player.isHost,
    score: player.score,
    connected: player.connected,
    isBot: player.isBot,
    isSpectator: player.isSpectator,
  };
}

export function createLobby(socketId: string, playerName: string, deckId: string, deckName: string): { lobby: LobbyState } | { error: string } {
  if (playerLobby.has(socketId)) {
    return { error: "You are already in a lobby" };
  }

  const code = generateCode();
  const player: Player = {
    id: socketId,
    name: playerName,
    isHost: true,
    score: 0,
    connected: true,
  };

  const lobby: Lobby = {
    code,
    players: new Map([[socketId, player]]),
    hostId: socketId,
    deckId,
    deckName,
    status: "waiting",
    maxPlayers: 10,
    createdAt: new Date(),
  };

  lobbies.set(code, lobby);
  playerLobby.set(socketId, code);

  return { lobby: lobbyToState(lobby) };
}

export function joinLobby(
  socketId: string,
  code: string,
  playerName: string
): { lobby: LobbyState; player: PlayerInfo } | { error: string } {
  if (playerLobby.has(socketId)) {
    return { error: "You are already in a lobby" };
  }

  const upperCode = code.toUpperCase();
  const lobby = lobbies.get(upperCode);

  if (!lobby) {
    return { error: "Lobby not found" };
  }

  if (lobby.players.size >= lobby.maxPlayers) {
    return { error: "Lobby is full" };
  }

  const player: Player = {
    id: socketId,
    name: playerName,
    isHost: false,
    score: 0,
    connected: true,
  };

  lobby.players.set(socketId, player);
  playerLobby.set(socketId, upperCode);

  return { lobby: lobbyToState(lobby), player: playerToInfo(player) };
}

export function joinAsSpectator(
  socketId: string,
  code: string,
  playerName: string
): { lobby: LobbyState; player: PlayerInfo } | { error: string } {
  if (playerLobby.has(socketId)) {
    return { error: "You are already in a lobby" };
  }

  const upperCode = code.toUpperCase();
  const lobby = lobbies.get(upperCode);

  if (!lobby) {
    return { error: "Lobby not found" };
  }

  const player: Player = {
    id: socketId,
    name: playerName,
    isHost: false,
    score: 0,
    connected: true,
    isSpectator: true,
  };

  lobby.players.set(socketId, player);
  playerLobby.set(socketId, upperCode);

  return { lobby: lobbyToState(lobby), player: playerToInfo(player) };
}

export function getActivePlayers(code: string): string[] | null {
  const lobby = lobbies.get(code);
  if (!lobby) return null;
  return Array.from(lobby.players.values())
    .filter(p => !p.isSpectator)
    .map(p => p.id);
}

// Explicit leave — actually removes the player from the lobby
export function leaveLobby(socketId: string): {
  code: string;
  lobby: LobbyState | null;
  newHostId?: string;
} | null {
  const code = playerLobby.get(socketId);
  if (!code) return null;

  const lobby = lobbies.get(code);
  if (!lobby) {
    playerLobby.delete(socketId);
    return null;
  }

  lobby.players.delete(socketId);
  playerLobby.delete(socketId);

  // If lobby is empty, delete it
  if (lobby.players.size === 0) {
    lobbies.delete(code);
    return { code, lobby: null };
  }

  // If host left, assign new host (prefer connected players)
  let newHostId: string | undefined;
  if (lobby.hostId === socketId) {
    const connectedPlayer = Array.from(lobby.players.values()).find(p => p.connected);
    const nextPlayer = connectedPlayer || lobby.players.values().next().value!;
    nextPlayer.isHost = true;
    lobby.hostId = nextPlayer.id;
    newHostId = nextPlayer.id;
  }

  return { code, lobby: lobbyToState(lobby), newHostId };
}

// Mark player as disconnected but keep them in the lobby
export function disconnectPlayer(socketId: string): { code: string; lobby: LobbyState } | null {
  const code = playerLobby.get(socketId);
  if (!code) return null;

  const lobby = lobbies.get(code);
  if (!lobby) return null;

  const player = lobby.players.get(socketId);
  if (!player) return null;

  player.connected = false;

  return { code, lobby: lobbyToState(lobby) };
}

// Mark player as connected again
export function reconnectPlayer(socketId: string): { code: string; lobby: LobbyState } | null {
  const code = playerLobby.get(socketId);
  if (!code) return null;

  const lobby = lobbies.get(code);
  if (!lobby) return null;

  const player = lobby.players.get(socketId);
  if (!player) return null;

  player.connected = true;

  return { code, lobby: lobbyToState(lobby) };
}

const BOT_NAMES = [
  "RoboPlayer", "CyberBot", "BotMcBotface", "DigitalDave",
  "SiliconSam", "ByteBuddy", "ChipChamp", "PixelPal",
  "NeonNinja", "LaserLlama", "TurboTron", "MegaBot",
];

export function addBot(socketId: string): { lobby: LobbyState; botId: string } | { error: string } {
  const code = playerLobby.get(socketId);
  if (!code) return { error: "You are not in a lobby" };

  const lobby = lobbies.get(code);
  if (!lobby) return { error: "Lobby not found" };

  if (lobby.hostId !== socketId) {
    return { error: "Only the host can add bots" };
  }

  if (lobby.players.size >= lobby.maxPlayers) {
    return { error: "Lobby is full" };
  }

  // Pick a bot name not already in use
  const usedNames = new Set(Array.from(lobby.players.values()).map(p => p.name));
  const name = BOT_NAMES.find(n => !usedNames.has(n)) || `Bot-${lobby.players.size}`;

  const botId = `bot-${randomBytes(4).toString("hex")}`;
  const player: Player = {
    id: botId,
    name,
    isHost: false,
    score: 0,
    connected: true,
    isBot: true,
  };

  lobby.players.set(botId, player);
  // Don't add to playerLobby — bots don't have real sockets

  return { lobby: lobbyToState(lobby), botId };
}

export function removeBot(socketId: string, botId: string): { lobby: LobbyState } | { error: string } {
  const code = playerLobby.get(socketId);
  if (!code) return { error: "You are not in a lobby" };

  const lobby = lobbies.get(code);
  if (!lobby) return { error: "Lobby not found" };

  if (lobby.hostId !== socketId) {
    return { error: "Only the host can remove bots" };
  }

  const player = lobby.players.get(botId);
  if (!player?.isBot) return { error: "Not a bot" };

  lobby.players.delete(botId);
  return { lobby: lobbyToState(lobby) };
}

export function kickPlayer(socketId: string, targetId: string): { lobby: LobbyState; code: string } | { error: string } {
  const code = playerLobby.get(socketId);
  if (!code) return { error: "You are not in a lobby" };

  const lobby = lobbies.get(code);
  if (!lobby) return { error: "Lobby not found" };

  if (lobby.hostId !== socketId) {
    return { error: "Only the host can kick players" };
  }

  if (targetId === socketId) {
    return { error: "You can't kick yourself" };
  }

  const target = lobby.players.get(targetId);
  if (!target) return { error: "Player not found" };

  lobby.players.delete(targetId);
  playerLobby.delete(targetId);

  return { lobby: lobbyToState(lobby), code };
}

export function getBotsInLobby(code: string): string[] {
  const lobby = lobbies.get(code);
  if (!lobby) return [];
  return Array.from(lobby.players.values())
    .filter(p => p.isBot)
    .map(p => p.id);
}

export function startGame(socketId: string): { code: string } | { error: string } {
  const code = playerLobby.get(socketId);
  if (!code) return { error: "You are not in a lobby" };

  const lobby = lobbies.get(code);
  if (!lobby) return { error: "Lobby not found" };

  if (lobby.hostId !== socketId) {
    return { error: "Only the host can start the game" };
  }

  const activePlayers = Array.from(lobby.players.values()).filter(p => !p.isSpectator);
  if (activePlayers.length < 2) {
    return { error: "Need at least 2 players to start (spectators don't count)" };
  }

  lobby.status = "playing";
  return { code };
}

export function getLobbyForSocket(socketId: string): string | undefined {
  return playerLobby.get(socketId);
}

export function getLobbyPlayers(code: string): string[] | null {
  const lobby = lobbies.get(code);
  if (!lobby) return null;
  return Array.from(lobby.players.keys());
}

export function getPlayerNameInLobby(code: string, playerId: string): string | undefined {
  const lobby = lobbies.get(code);
  if (!lobby) return undefined;
  return lobby.players.get(playerId)?.name;
}

export function getLobbyDeckId(code: string): string | undefined {
  return lobbies.get(code)?.deckId;
}

export function remapPlayer(
  oldSocketId: string,
  newSocketId: string
): { code: string; lobby: LobbyState } | null {
  const code = playerLobby.get(oldSocketId);
  if (!code) return null;

  const lobby = lobbies.get(code);
  if (!lobby) return null;

  const player = lobby.players.get(oldSocketId);
  if (!player) return null;

  // Move player entry to new socket ID
  lobby.players.delete(oldSocketId);
  player.id = newSocketId;
  player.connected = true;
  lobby.players.set(newSocketId, player);

  // Update host reference
  if (lobby.hostId === oldSocketId) {
    lobby.hostId = newSocketId;
  }

  // Update playerLobby mapping
  playerLobby.delete(oldSocketId);
  playerLobby.set(newSocketId, code);

  return { code, lobby: lobbyToState(lobby) };
}
