import { randomBytes } from "crypto";
import type { Lobby, Player, LobbyState, PlayerInfo } from "./types.js";
import { redis, withGameLock } from "./redis.js";

// ── Storage ──────────────────────────────────────────────────────────────────
// Lobbies live in Redis (one JSON blob per lobby) when REDIS_URL is set, so
// every replica reads and writes the same shared state. Without Redis we fall
// back to local Maps — same behaviour as before, fine for tests and
// single-replica dev.
//
// Atomicity: every public mutation is wrapped in withGameLock("lobby", code)
// so concurrent load → mutate → save sequences from two replicas don't
// clobber each other.

const LOBBY_KEY = (code: string) => `lobby:${code}`;
const PL_KEY = "player-lobby"; // hash socketId -> code

const localLobbies = new Map<string, Lobby>();
const localPlayerLobby = new Map<string, string>();

interface SerialisedLobby {
  code: string;
  players: Record<string, Player>;
  hostId: string;
  deckId: string;
  deckName: string;
  gameType: Lobby["gameType"];
  winCondition: Lobby["winCondition"];
  houseRules: Lobby["houseRules"];
  status: Lobby["status"];
  maxPlayers: number;
  createdAt: string;
  rematchVotes: string[];
}

function serialiseLobby(lobby: Lobby): SerialisedLobby {
  const players: Record<string, Player> = {};
  for (const [id, p] of lobby.players) players[id] = p;
  return {
    code: lobby.code,
    players,
    hostId: lobby.hostId,
    deckId: lobby.deckId,
    deckName: lobby.deckName,
    gameType: lobby.gameType,
    winCondition: lobby.winCondition,
    houseRules: lobby.houseRules,
    status: lobby.status,
    maxPlayers: lobby.maxPlayers,
    createdAt: lobby.createdAt.toISOString(),
    rematchVotes: [...lobby.rematchVotes],
  };
}

function deserialiseLobby(s: SerialisedLobby): Lobby {
  return {
    code: s.code,
    players: new Map(Object.entries(s.players)),
    hostId: s.hostId,
    deckId: s.deckId,
    deckName: s.deckName,
    gameType: s.gameType,
    winCondition: s.winCondition,
    houseRules: s.houseRules || {},
    status: s.status,
    maxPlayers: s.maxPlayers,
    createdAt: new Date(s.createdAt),
    rematchVotes: new Set(s.rematchVotes || []),
  };
}

async function getLobby(code: string): Promise<Lobby | undefined> {
  if (redis) {
    const json = await redis.get(LOBBY_KEY(code));
    return json ? deserialiseLobby(JSON.parse(json)) : undefined;
  }
  return localLobbies.get(code);
}

async function saveLobby(lobby: Lobby): Promise<void> {
  if (redis) {
    await redis.set(LOBBY_KEY(lobby.code), JSON.stringify(serialiseLobby(lobby)));
    return;
  }
  localLobbies.set(lobby.code, lobby);
}

async function deleteLobby(code: string): Promise<void> {
  if (redis) {
    await redis.del(LOBBY_KEY(code));
    return;
  }
  localLobbies.delete(code);
}

async function lobbyExists(code: string): Promise<boolean> {
  if (redis) return (await redis.exists(LOBBY_KEY(code))) === 1;
  return localLobbies.has(code);
}

async function getAllLobbies(): Promise<Lobby[]> {
  if (redis) {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", "lobby:*", "COUNT", 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
    if (keys.length === 0) return [];
    const raws = await redis.mget(...keys);
    return raws
      .filter((r): r is string => !!r)
      .map(r => deserialiseLobby(JSON.parse(r)));
  }
  return Array.from(localLobbies.values());
}

async function getPlayerLobbyCode(socketId: string): Promise<string | undefined> {
  if (redis) return (await redis.hget(PL_KEY, socketId)) ?? undefined;
  return localPlayerLobby.get(socketId);
}

async function setPlayerLobbyCode(socketId: string, code: string): Promise<void> {
  if (redis) {
    await redis.hset(PL_KEY, socketId, code);
    return;
  }
  localPlayerLobby.set(socketId, code);
}

async function deletePlayerLobbyCode(socketId: string): Promise<void> {
  if (redis) {
    await redis.hdel(PL_KEY, socketId);
    return;
  }
  localPlayerLobby.delete(socketId);
}

/** Return a uniform random index in [0, max) using rejection sampling. */
function uniformRandom(max: number): number {
  const limit = 256 - (256 % max); // largest multiple of max that fits in a byte
  let b: number;
  do { b = randomBytes(1)[0]; } while (b >= limit);
  return b % max;
}

async function generateCode(): Promise<string> {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O to avoid confusion
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => chars[uniformRandom(chars.length)]).join("");
  } while (await lobbyExists(code));
  return code;
}

function lobbyToState(lobby: Lobby): LobbyState {
  return {
    code: lobby.code,
    players: Array.from(lobby.players.values()).map(playerToInfo),
    hostId: lobby.hostId,
    deckId: lobby.deckId,
    deckName: lobby.deckName,
    gameType: lobby.gameType,
    winCondition: lobby.winCondition,
    houseRules: lobby.houseRules,
    status: lobby.status,
    maxPlayers: lobby.maxPlayers,
    rematchVotes: lobby.rematchVotes.size,
    rematchVoters: [...lobby.rematchVotes],
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

// ── Public API ───────────────────────────────────────────────────────────────

export async function createLobby(socketId: string, playerName: string, deckId: string, deckName: string, gameType?: string, winCondition?: { mode: string; value: number }): Promise<{ lobby: LobbyState } | { error: string }> {
  if (await getPlayerLobbyCode(socketId)) {
    return { error: "You are already in a lobby" };
  }

  const code = await generateCode();
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
    gameType: (gameType as any) || "cah",
    winCondition: winCondition || { mode: "rounds", value: 10 },
    houseRules: {},
    status: "waiting",
    maxPlayers: 10,
    createdAt: new Date(),
    rematchVotes: new Set(),
  };

  await saveLobby(lobby);
  await setPlayerLobbyCode(socketId, code);

  return { lobby: lobbyToState(lobby) };
}

export async function joinLobby(
  socketId: string,
  code: string,
  playerName: string
): Promise<{ lobby: LobbyState; player: PlayerInfo } | { error: string }> {
  if (await getPlayerLobbyCode(socketId)) {
    return { error: "You are already in a lobby" };
  }

  const upperCode = code.toUpperCase();
  return withGameLock("lobby", upperCode, async () => {
  const lobby = await getLobby(upperCode);

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
  await saveLobby(lobby);
  await setPlayerLobbyCode(socketId, upperCode);

  return { lobby: lobbyToState(lobby), player: playerToInfo(player) };
  });
}

export async function joinAsSpectator(
  socketId: string,
  code: string,
  playerName: string
): Promise<{ lobby: LobbyState; player: PlayerInfo } | { error: string }> {
  if (await getPlayerLobbyCode(socketId)) {
    return { error: "You are already in a lobby" };
  }

  const upperCode = code.toUpperCase();
  return withGameLock("lobby", upperCode, async () => {
  const lobby = await getLobby(upperCode);

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
  await saveLobby(lobby);
  await setPlayerLobbyCode(socketId, upperCode);

  return { lobby: lobbyToState(lobby), player: playerToInfo(player) };
  });
}

export async function getActivePlayers(code: string): Promise<string[] | null> {
  const lobby = await getLobby(code);
  if (!lobby) return null;
  return Array.from(lobby.players.values())
    .filter(p => !p.isSpectator)
    .map(p => p.id);
}

// Explicit leave — actually removes the player from the lobby
export async function leaveLobby(socketId: string): Promise<{
  code: string;
  lobby: LobbyState | null;
  newHostId?: string;
} | null> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return null;
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
  if (!lobby) {
    await deletePlayerLobbyCode(socketId);
    return null;
  }

  lobby.players.delete(socketId);
  await deletePlayerLobbyCode(socketId);

  // If lobby is empty, delete it
  if (lobby.players.size === 0) {
    await deleteLobby(code);
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

  await saveLobby(lobby);

  return { code, lobby: lobbyToState(lobby), newHostId };
  });
}

// Mark player as disconnected but keep them in the lobby
export async function disconnectPlayer(socketId: string): Promise<{ code: string; lobby: LobbyState } | null> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return null;
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
  if (!lobby) return null;

  const player = lobby.players.get(socketId);
  if (!player) return null;

  player.connected = false;
  await saveLobby(lobby);

  return { code, lobby: lobbyToState(lobby) };
  });
}

// Mark player as connected again
export async function reconnectPlayer(socketId: string): Promise<{ code: string; lobby: LobbyState } | null> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return null;
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
  if (!lobby) return null;

  const player = lobby.players.get(socketId);
  if (!player) return null;

  player.connected = true;
  await saveLobby(lobby);

  return { code, lobby: lobbyToState(lobby) };
  });
}

const BOT_NAMES = [
  "RoboPlayer", "CyberBot", "BotMcBotface", "DigitalDave",
  "SiliconSam", "ByteBuddy", "ChipChamp", "PixelPal",
  "NeonNinja", "LaserLlama", "TurboTron", "MegaBot",
];

export async function addBot(socketId: string): Promise<{ lobby: LobbyState; botId: string } | { error: string }> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return { error: "You are not in a lobby" };
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
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
  await saveLobby(lobby);
  // Don't add to playerLobby — bots don't have real sockets

  return { lobby: lobbyToState(lobby), botId };
  });
}

export async function removeBot(socketId: string, botId: string): Promise<{ lobby: LobbyState } | { error: string }> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return { error: "You are not in a lobby" };
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "Lobby not found" };

  if (lobby.hostId !== socketId) {
    return { error: "Only the host can remove bots" };
  }

  const player = lobby.players.get(botId);
  if (!player?.isBot) return { error: "Not a bot" };

  lobby.players.delete(botId);
  await saveLobby(lobby);
  return { lobby: lobbyToState(lobby) };
  });
}

export async function kickPlayer(socketId: string, targetId: string): Promise<{ lobby: LobbyState; code: string } | { error: string }> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return { error: "You are not in a lobby" };
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
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
  await saveLobby(lobby);
  await deletePlayerLobbyCode(targetId);

  return { lobby: lobbyToState(lobby), code };
  });
}

export async function getBotsInLobby(code: string): Promise<string[]> {
  const lobby = await getLobby(code);
  if (!lobby) return [];
  return Array.from(lobby.players.values())
    .filter(p => p.isBot)
    .map(p => p.id);
}

export async function startGame(socketId: string): Promise<{ code: string } | { error: string }> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return { error: "You are not in a lobby" };
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "Lobby not found" };

  if (lobby.hostId !== socketId) {
    return { error: "Only the host can start the game" };
  }

  const activePlayers = Array.from(lobby.players.values()).filter(p => !p.isSpectator);
  if (activePlayers.length < 2) {
    return { error: "Need at least 2 players to start (spectators don't count)" };
  }

  lobby.status = "playing";
  await saveLobby(lobby);
  return { code };
  });
}

export async function changeLobbyDeck(socketId: string, deckId: string, deckName: string, gameType: string, winCondition: { mode: string; value: number }): Promise<{ code: string; lobby: LobbyState } | { error: string }> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return { error: "You are not in a lobby" };
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "Lobby not found" };

  if (lobby.hostId !== socketId) return { error: "Only the host can change the deck" };
  if (lobby.status !== "waiting") return { error: "Cannot change deck while playing" };

  lobby.deckId = deckId;
  lobby.deckName = deckName;
  lobby.gameType = (gameType as any) || "cah";
  lobby.winCondition = winCondition || { mode: "rounds", value: 10 };
  await saveLobby(lobby);

  return { code, lobby: lobbyToState(lobby) };
  });
}

export async function voteRematch(socketId: string): Promise<{ code: string; lobby: LobbyState; voteCount: number; totalPlayers: number } | { error: string }> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return { error: "You are not in a lobby" };
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "Lobby not found" };

  lobby.rematchVotes.add(socketId);
  await saveLobby(lobby);
  const activePlayers = Array.from(lobby.players.values()).filter(p => !p.isSpectator && !p.isBot);
  return { code, lobby: lobbyToState(lobby), voteCount: lobby.rematchVotes.size, totalPlayers: activePlayers.length };
  });
}

export async function resetLobbyForRematch(socketId: string): Promise<{ code: string; lobby: LobbyState } | { error: string }> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return { error: "You are not in a lobby" };
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "Lobby not found" };

  if (lobby.hostId !== socketId) {
    return { error: "Only the host can start a rematch" };
  }

  lobby.status = "waiting";
  lobby.rematchVotes.clear();

  // Reset all player scores
  for (const player of lobby.players.values()) {
    player.score = 0;
  }

  await saveLobby(lobby);

  return { code, lobby: lobbyToState(lobby) };
  });
}

export async function getLobbyForSocket(socketId: string): Promise<string | undefined> {
  return getPlayerLobbyCode(socketId);
}

export async function getLobbyPlayers(code: string): Promise<string[] | null> {
  const lobby = await getLobby(code);
  if (!lobby) return null;
  return Array.from(lobby.players.keys());
}

export async function getPlayerNameInLobby(code: string, playerId: string): Promise<string | undefined> {
  const lobby = await getLobby(code);
  if (!lobby) return undefined;
  return lobby.players.get(playerId)?.name;
}

export async function getLobbyDeckId(code: string): Promise<string | undefined> {
  return (await getLobby(code))?.deckId;
}

export async function getLobbyDeckName(code: string): Promise<string | undefined> {
  return (await getLobby(code))?.deckName;
}

export async function getLobbyGameType(code: string): Promise<string | undefined> {
  return (await getLobby(code))?.gameType;
}

export async function isPlayerBot(code: string, playerId: string): Promise<boolean> {
  const lobby = await getLobby(code);
  if (!lobby) return false;
  return lobby.players.get(playerId)?.isBot || false;
}

export async function setLobbyHouseRules(socketId: string, houseRules: { unoStacking?: boolean; botCzar?: boolean }): Promise<{ code: string; lobby: LobbyState } | { error: string }> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return { error: "You are not in a lobby" };
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "Lobby not found" };

  if (lobby.hostId !== socketId) return { error: "Only the host can change house rules" };
  if (lobby.status !== "waiting") return { error: "Cannot change rules while playing" };

  lobby.houseRules = houseRules;
  await saveLobby(lobby);

  return { code, lobby: lobbyToState(lobby) };
  });
}

export async function setMaxPlayers(socketId: string, maxPlayers: number): Promise<{ code: string; lobby: LobbyState } | { error: string }> {
  const code = await getPlayerLobbyCode(socketId);
  if (!code) return { error: "You are not in a lobby" };
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "Lobby not found" };

  if (lobby.hostId !== socketId) return { error: "Only the host can change player limit" };
  if (lobby.status !== "waiting") return { error: "Cannot change player limit while playing" };
  if (maxPlayers < 2 || maxPlayers > 50) return { error: "Player limit must be between 2 and 50" };
  if (lobby.players.size > maxPlayers) return { error: "Cannot set limit below current player count" };

  lobby.maxPlayers = maxPlayers;
  await saveLobby(lobby);

  return { code, lobby: lobbyToState(lobby) };
  });
}

export async function getLobbyHouseRules(code: string): Promise<{ unoStacking?: boolean; botCzar?: boolean } | undefined> {
  return (await getLobby(code))?.houseRules;
}

// ── Snapshot / Restore ───────────────────────────────────────────────────────
// Used by snapshot.ts on graceful shutdown / startup so active lobbies
// survive redeploys. Socket.ids inside the snapshot are stale; they get
// remapped through the normal reconnect flow when clients rejoin.

export async function exportLobbies(): Promise<any[]> {
  const lobbies = await getAllLobbies();
  return lobbies.map(lobby => ({
    code: lobby.code,
    players: Array.from(lobby.players.entries()),
    hostId: lobby.hostId,
    deckId: lobby.deckId,
    deckName: lobby.deckName,
    gameType: lobby.gameType,
    winCondition: lobby.winCondition,
    houseRules: lobby.houseRules,
    status: lobby.status,
    maxPlayers: lobby.maxPlayers,
    createdAt: lobby.createdAt.toISOString(),
    rematchVotes: Array.from(lobby.rematchVotes),
  }));
}

const ABANDONED_LOBBY_AGE_MS = 2 * 60 * 60 * 1000; // 2h old lobby → abandoned

export async function restoreLobbies(snapshots: any[]): Promise<void> {
  for (const s of snapshots) {
    const createdAt = new Date(s.createdAt);
    // Skip abandoned lobbies — if a lobby is older than 2h we're re-animating
    // something nobody's come back to. Drops zombie state that otherwise
    // loops through every deploy cycle (snapshot → restore → snapshot).
    if (Date.now() - createdAt.getTime() > ABANDONED_LOBBY_AGE_MS) {
      continue;
    }
    const lobby: Lobby = {
      code: s.code,
      players: new Map(s.players),
      hostId: s.hostId,
      deckId: s.deckId,
      deckName: s.deckName,
      gameType: s.gameType,
      winCondition: s.winCondition,
      houseRules: s.houseRules || {},
      status: s.status,
      maxPlayers: s.maxPlayers,
      createdAt,
      rematchVotes: new Set(s.rematchVotes || []),
    };
    // Mark every player disconnected until they reconnect via sessionId
    for (const p of lobby.players.values()) p.connected = false;
    await saveLobby(lobby);
    for (const [socketId, p] of lobby.players) {
      if (!p.isBot) await setPlayerLobbyCode(socketId, lobby.code);
    }
  }
}

export async function remapPlayer(
  oldSocketId: string,
  newSocketId: string
): Promise<{ code: string; lobby: LobbyState } | null> {
  const code = await getPlayerLobbyCode(oldSocketId);
  if (!code) return null;
  return withGameLock("lobby", code, async () => {
  const lobby = await getLobby(code);
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

  await saveLobby(lobby);
  await deletePlayerLobbyCode(oldSocketId);
  await setPlayerLobbyCode(newSocketId, code);

  return { code, lobby: lobbyToState(lobby) };
  });
}
