import { describe, it, expect, beforeEach } from "vitest";
import {
  createLobby,
  joinLobby,
  joinAsSpectator,
  leaveLobby,
  disconnectPlayer,
  reconnectPlayer,
  remapPlayer,
  addBot,
  removeBot,
  kickPlayer,
  startGame,
  changeLobbyDeck,
  voteRematch,
  resetLobbyForRematch,
  setLobbyHouseRules,
  setMaxPlayers,
  getLobbyForSocket,
  getLobbyPlayers,
  getPlayerNameInLobby,
  getLobbyDeckId,
  getLobbyGameType,
  getActivePlayers,
  getBotsInLobby,
  isPlayerBot,
  getLobbyHouseRules,
} from "../lobby.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a lobby and return its code (throws on error). */
async function create(socketId = "host", name = "Host", deckId = "d1", deckName = "Test Deck") {
  const result = await createLobby(socketId, name, deckId, deckName);
  if ("error" in result) throw new Error(result.error);
  return result.lobby.code;
}

/** Join an existing lobby (throws on error). */
async function join(socketId: string, code: string, name = socketId) {
  const result = await joinLobby(socketId, code, name);
  if ("error" in result) throw new Error(result.error);
  return result;
}

// ── Teardown ─────────────────────────────────────────────────────────────────

beforeEach(async () => {
  // Drain all lobbies by leaving every known socket.
  // This is brute-force but keeps tests independent without exporting internals.
  for (const sid of ["host", "p1", "p2", "p3", "p4", "spec1"]) {
    while (await getLobbyForSocket(sid)) await leaveLobby(sid);
  }
});

// ── createLobby ──────────────────────────────────────────────────────────────

describe("createLobby", () => {
  it("returns a 4-letter lobby code", async () => {
    const result = await createLobby("host", "Host", "d1", "Deck");
    expect("lobby" in result && result.lobby.code).toMatch(/^[A-Z]{4}$/);
  });

  it("sets creator as host", async () => {
    const result = await createLobby("host", "Host", "d1", "Deck") as any;
    expect(result.lobby.hostId).toBe("host");
    expect(result.lobby.players[0].isHost).toBe(true);
  });

  it("rejects duplicate socket", async () => {
    await create("host");
    const result = await createLobby("host", "Host", "d1", "Deck");
    expect("error" in result).toBe(true);
  });

  it("stores deck and game type", async () => {
    const result = await createLobby("host", "Host", "d1", "My Deck", "uno") as any;
    expect(result.lobby.deckName).toBe("My Deck");
    expect(result.lobby.gameType).toBe("uno");
  });
});

// ── joinLobby ────────────────────────────────────────────────────────────────

describe("joinLobby", () => {
  it("adds player to existing lobby", async () => {
    const code = await create("host");
    const result = await joinLobby("p1", code, "Player1");
    expect("lobby" in result && result.lobby.players).toHaveLength(2);
  });

  it("is case-insensitive on code", async () => {
    const code = await create("host");
    const result = await joinLobby("p1", code.toLowerCase(), "Player1");
    expect("error" in result).toBe(false);
  });

  it("rejects unknown code", async () => {
    const result = await joinLobby("p1", "ZZZZ", "Player1");
    expect("error" in result).toBe(true);
  });

  it("rejects when lobby is full", async () => {
    const code = await create("host");
    // Set max to 2, then fill it
    await setMaxPlayers("host", 2);
    await join("p1", code);
    const result = await joinLobby("p2", code, "Player2");
    expect("error" in result).toBe(true);
  });
});

// ── joinAsSpectator ──────────────────────────────────────────────────────────

describe("joinAsSpectator", () => {
  it("marks player as spectator", async () => {
    const code = await create("host");
    const result = await joinAsSpectator("spec1", code, "Spectator") as any;
    const spec = result.lobby.players.find((p: any) => p.id === "spec1");
    expect(spec.isSpectator).toBe(true);
  });

  it("spectators excluded from active players", async () => {
    const code = await create("host");
    await joinAsSpectator("spec1", code, "Spectator");
    const active = (await getActivePlayers(code))!;
    expect(active).not.toContain("spec1");
    expect(active).toContain("host");
  });
});

// ── leaveLobby ───────────────────────────────────────────────────────────────

describe("leaveLobby", () => {
  it("removes player and returns updated lobby", async () => {
    const code = await create("host");
    await join("p1", code);
    const result = (await leaveLobby("p1"))!;
    expect(result.lobby!.players).toHaveLength(1);
  });

  it("deletes lobby when last player leaves", async () => {
    await create("host");
    const result = (await leaveLobby("host"))!;
    expect(result.lobby).toBeNull();
  });

  it("transfers host when host leaves", async () => {
    const code = await create("host");
    await join("p1", code);
    const result = (await leaveLobby("host"))!;
    expect(result.newHostId).toBe("p1");
    expect(result.lobby!.hostId).toBe("p1");
  });

  it("returns null for unknown socket", async () => {
    expect(await leaveLobby("nobody")).toBeNull();
  });
});

// ── disconnect / reconnect ───────────────────────────────────────────────────

describe("disconnect and reconnect", () => {
  it("marks player as disconnected", async () => {
    await create("host");
    const result = (await disconnectPlayer("host"))!;
    const hostPlayer = result.lobby.players.find((p) => p.id === "host");
    expect(hostPlayer!.connected).toBe(false);
  });

  it("marks player as connected on reconnect", async () => {
    await create("host");
    await disconnectPlayer("host");
    const result = (await reconnectPlayer("host"))!;
    const hostPlayer = result.lobby.players.find((p) => p.id === "host");
    expect(hostPlayer!.connected).toBe(true);
  });
});

// ── remapPlayer ──────────────────────────────────────────────────────────────

describe("remapPlayer", () => {
  it("moves player to new socket ID", async () => {
    await create("host");
    const result = (await remapPlayer("host", "host-new"))!;
    expect(result.lobby.players.find((p) => p.id === "host-new")).toBeTruthy();
    expect(result.lobby.players.find((p) => p.id === "host")).toBeFalsy();
  });

  it("updates host reference", async () => {
    await create("host");
    const result = (await remapPlayer("host", "host-new"))!;
    expect(result.lobby.hostId).toBe("host-new");
  });

  it("returns null for unknown socket", async () => {
    expect(await remapPlayer("nobody", "new")).toBeNull();
  });
});

// ── Bots ─────────────────────────────────────────────────────────────────────

describe("addBot / removeBot", () => {
  it("host can add a bot", async () => {
    const code = await create("host");
    const result = await addBot("host");
    expect("botId" in result).toBe(true);
    expect(await getBotsInLobby(code)).toHaveLength(1);
  });

  it("non-host cannot add a bot", async () => {
    const code = await create("host");
    await join("p1", code);
    const result = await addBot("p1");
    expect("error" in result).toBe(true);
  });

  it("host can remove a bot", async () => {
    const code = await create("host");
    const added = await addBot("host") as any;
    const result = await removeBot("host", added.botId);
    expect("error" in result).toBe(false);
    expect(await getBotsInLobby(code)).toHaveLength(0);
  });

  it("cannot remove a non-bot player", async () => {
    const code = await create("host");
    await join("p1", code);
    const result = await removeBot("host", "p1");
    expect("error" in result).toBe(true);
  });

  it("isPlayerBot returns true for bots", async () => {
    const code = await create("host");
    const added = await addBot("host") as any;
    expect(await isPlayerBot(code, added.botId)).toBe(true);
    expect(await isPlayerBot(code, "host")).toBe(false);
  });
});

// ── kickPlayer ───────────────────────────────────────────────────────────────

describe("kickPlayer", () => {
  it("host can kick a player", async () => {
    const code = await create("host");
    await join("p1", code);
    const result = await kickPlayer("host", "p1");
    expect("error" in result).toBe(false);
    expect(await getLobbyPlayers(code)).not.toContain("p1");
  });

  it("non-host cannot kick", async () => {
    const code = await create("host");
    await join("p1", code);
    const result = await kickPlayer("p1", "host");
    expect("error" in result).toBe(true);
  });

  it("cannot kick yourself", async () => {
    await create("host");
    const result = await kickPlayer("host", "host");
    expect("error" in result).toBe(true);
  });
});

// ── startGame ────────────────────────────────────────────────────────────────

describe("startGame", () => {
  it("host can start with 2+ players", async () => {
    const code = await create("host");
    await join("p1", code);
    const result = await startGame("host");
    expect("code" in result).toBe(true);
  });

  it("cannot start with only 1 player", async () => {
    await create("host");
    const result = await startGame("host");
    expect("error" in result).toBe(true);
  });

  it("non-host cannot start", async () => {
    const code = await create("host");
    await join("p1", code);
    const result = await startGame("p1");
    expect("error" in result).toBe(true);
  });

  it("spectators don't count toward minimum", async () => {
    const code = await create("host");
    await joinAsSpectator("spec1", code, "Spectator");
    const result = await startGame("host");
    expect("error" in result).toBe(true);
  });
});

// ── changeLobbyDeck ──────────────────────────────────────────────────────────

describe("changeLobbyDeck", () => {
  it("host can change deck while waiting", async () => {
    const code = await create("host");
    const result = await changeLobbyDeck("host", "d2", "New Deck", "cah", { mode: "points", value: 5 });
    expect("lobby" in result && result.lobby.deckName).toBe("New Deck");
    expect(await getLobbyDeckId(code)).toBe("d2");
  });

  it("cannot change deck while playing", async () => {
    const code = await create("host");
    await join("p1", code);
    await startGame("host");
    const result = await changeLobbyDeck("host", "d2", "New", "cah", { mode: "rounds", value: 5 });
    expect("error" in result).toBe(true);
  });
});

// ── setLobbyHouseRules ───────────────────────────────────────────────────────

describe("setLobbyHouseRules", () => {
  it("host can set house rules", async () => {
    const code = await create("host");
    await setLobbyHouseRules("host", { unoStacking: true });
    expect(await getLobbyHouseRules(code)).toEqual({ unoStacking: true });
  });

  it("non-host cannot set house rules", async () => {
    const code = await create("host");
    await join("p1", code);
    const result = await setLobbyHouseRules("p1", { unoStacking: true });
    expect("error" in result).toBe(true);
  });
});

// ── setMaxPlayers ────────────────────────────────────────────────────────────

describe("setMaxPlayers", () => {
  it("host can change max players", async () => {
    await create("host");
    const result = await setMaxPlayers("host", 20) as any;
    expect(result.lobby.maxPlayers).toBe(20);
  });

  it("rejects values below 2 or above 50", async () => {
    await create("host");
    expect("error" in (await setMaxPlayers("host", 1))).toBe(true);
    expect("error" in (await setMaxPlayers("host", 51))).toBe(true);
  });

  it("cannot set below current player count", async () => {
    const code = await create("host");
    await join("p1", code);
    await join("p2", code);
    const result = await setMaxPlayers("host", 2);
    expect("error" in result).toBe(true);
  });
});

// ── voteRematch / resetLobbyForRematch ───────────────────────────────────────

describe("rematch flow", () => {
  it("players can vote for rematch", async () => {
    const code = await create("host");
    await join("p1", code);
    const result = await voteRematch("host") as any;
    expect(result.voteCount).toBe(1);
    expect(result.totalPlayers).toBe(2);
  });

  it("host can reset lobby for rematch", async () => {
    const code = await create("host");
    await join("p1", code);
    await startGame("host");
    const result = await resetLobbyForRematch("host") as any;
    expect(result.lobby.status).toBe("waiting");
    expect(result.lobby.players.every((p: any) => p.score === 0)).toBe(true);
  });

  it("non-host cannot reset for rematch", async () => {
    const code = await create("host");
    await join("p1", code);
    const result = await resetLobbyForRematch("p1");
    expect("error" in result).toBe(true);
  });
});

// ── Lookup helpers ───────────────────────────────────────────────────────────

describe("lookup helpers", () => {
  it("getLobbyForSocket returns code", async () => {
    const code = await create("host");
    expect(await getLobbyForSocket("host")).toBe(code);
    expect(await getLobbyForSocket("nobody")).toBeUndefined();
  });

  it("getPlayerNameInLobby returns name", async () => {
    const code = await create("host", "HostName");
    expect(await getPlayerNameInLobby(code, "host")).toBe("HostName");
    expect(await getPlayerNameInLobby(code, "nobody")).toBeUndefined();
  });

  it("getLobbyGameType returns game type", async () => {
    const code = await create("host");
    expect(await getLobbyGameType(code)).toBe("cah");
  });
});
