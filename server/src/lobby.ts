import type { Lobby, Player, LobbyState, PlayerInfo } from "./types.js";

const lobbies = new Map<string, Lobby>();
const playerLobby = new Map<string, string>(); // socketId -> lobbyCode

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O to avoid confusion
  let code: string;
  do {
    code = Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
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

  if (lobby.status !== "waiting") {
    return { error: "Game already in progress" };
  }

  if (lobby.players.size >= lobby.maxPlayers) {
    return { error: "Lobby is full" };
  }

  const player: Player = {
    id: socketId,
    name: playerName,
    isHost: false,
    score: 0,
  };

  lobby.players.set(socketId, player);
  playerLobby.set(socketId, upperCode);

  return { lobby: lobbyToState(lobby), player: playerToInfo(player) };
}

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

  // If host left, assign new host
  let newHostId: string | undefined;
  if (lobby.hostId === socketId) {
    const nextPlayer = lobby.players.values().next().value!;
    nextPlayer.isHost = true;
    lobby.hostId = nextPlayer.id;
    newHostId = nextPlayer.id;
  }

  return { code, lobby: lobbyToState(lobby), newHostId };
}

export function startGame(socketId: string): { code: string } | { error: string } {
  const code = playerLobby.get(socketId);
  if (!code) return { error: "You are not in a lobby" };

  const lobby = lobbies.get(code);
  if (!lobby) return { error: "Lobby not found" };

  if (lobby.hostId !== socketId) {
    return { error: "Only the host can start the game" };
  }

  if (lobby.players.size < 2) {
    return { error: "Need at least 3 players to start" };
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
