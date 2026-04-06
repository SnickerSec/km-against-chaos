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
function create(socketId = "host", name = "Host", deckId = "d1", deckName = "Test Deck") {
  const result = createLobby(socketId, name, deckId, deckName);
  if ("error" in result) throw new Error(result.error);
  return result.lobby.code;
}

/** Join an existing lobby (throws on error). */
function join(socketId: string, code: string, name = socketId) {
  const result = joinLobby(socketId, code, name);
  if ("error" in result) throw new Error(result.error);
  return result;
}

// ── Teardown ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Drain all lobbies by leaving every known socket.
  // This is brute-force but keeps tests independent without exporting internals.
  for (const sid of ["host", "p1", "p2", "p3", "p4", "spec1"]) {
    while (getLobbyForSocket(sid)) leaveLobby(sid);
  }
});

// ── createLobby ──────────────────────────────────────────────────────────────

describe("createLobby", () => {
  it("returns a 4-letter lobby code", () => {
    const result = createLobby("host", "Host", "d1", "Deck");
    expect("lobby" in result && result.lobby.code).toMatch(/^[A-Z]{4}$/);
  });

  it("sets creator as host", () => {
    const result = createLobby("host", "Host", "d1", "Deck") as any;
    expect(result.lobby.hostId).toBe("host");
    expect(result.lobby.players[0].isHost).toBe(true);
  });

  it("rejects duplicate socket", () => {
    create("host");
    const result = createLobby("host", "Host", "d1", "Deck");
    expect("error" in result).toBe(true);
  });

  it("stores deck and game type", () => {
    const result = createLobby("host", "Host", "d1", "My Deck", "uno") as any;
    expect(result.lobby.deckName).toBe("My Deck");
    expect(result.lobby.gameType).toBe("uno");
  });
});

// ── joinLobby ────────────────────────────────────────────────────────────────

describe("joinLobby", () => {
  it("adds player to existing lobby", () => {
    const code = create("host");
    const result = joinLobby("p1", code, "Player1");
    expect("lobby" in result && result.lobby.players).toHaveLength(2);
  });

  it("is case-insensitive on code", () => {
    const code = create("host");
    const result = joinLobby("p1", code.toLowerCase(), "Player1");
    expect("error" in result).toBe(false);
  });

  it("rejects unknown code", () => {
    const result = joinLobby("p1", "ZZZZ", "Player1");
    expect("error" in result).toBe(true);
  });

  it("rejects when lobby is full", () => {
    const code = create("host");
    // Set max to 2, then fill it
    setMaxPlayers("host", 2);
    join("p1", code);
    const result = joinLobby("p2", code, "Player2");
    expect("error" in result).toBe(true);
  });
});

// ── joinAsSpectator ──────────────────────────────────────────────────────────

describe("joinAsSpectator", () => {
  it("marks player as spectator", () => {
    const code = create("host");
    const result = joinAsSpectator("spec1", code, "Spectator") as any;
    const spec = result.lobby.players.find((p: any) => p.id === "spec1");
    expect(spec.isSpectator).toBe(true);
  });

  it("spectators excluded from active players", () => {
    const code = create("host");
    joinAsSpectator("spec1", code, "Spectator");
    const active = getActivePlayers(code)!;
    expect(active).not.toContain("spec1");
    expect(active).toContain("host");
  });
});

// ── leaveLobby ───────────────────────────────────────────────────────────────

describe("leaveLobby", () => {
  it("removes player and returns updated lobby", () => {
    const code = create("host");
    join("p1", code);
    const result = leaveLobby("p1")!;
    expect(result.lobby!.players).toHaveLength(1);
  });

  it("deletes lobby when last player leaves", () => {
    const code = create("host");
    const result = leaveLobby("host")!;
    expect(result.lobby).toBeNull();
  });

  it("transfers host when host leaves", () => {
    const code = create("host");
    join("p1", code);
    const result = leaveLobby("host")!;
    expect(result.newHostId).toBe("p1");
    expect(result.lobby!.hostId).toBe("p1");
  });

  it("returns null for unknown socket", () => {
    expect(leaveLobby("nobody")).toBeNull();
  });
});

// ── disconnect / reconnect ───────────────────────────────────────────────────

describe("disconnect and reconnect", () => {
  it("marks player as disconnected", () => {
    const code = create("host");
    const result = disconnectPlayer("host")!;
    const hostPlayer = result.lobby.players.find((p) => p.id === "host");
    expect(hostPlayer!.connected).toBe(false);
  });

  it("marks player as connected on reconnect", () => {
    create("host");
    disconnectPlayer("host");
    const result = reconnectPlayer("host")!;
    const hostPlayer = result.lobby.players.find((p) => p.id === "host");
    expect(hostPlayer!.connected).toBe(true);
  });
});

// ── remapPlayer ──────────────────────────────────────────────────────────────

describe("remapPlayer", () => {
  it("moves player to new socket ID", () => {
    const code = create("host");
    const result = remapPlayer("host", "host-new")!;
    expect(result.lobby.players.find((p) => p.id === "host-new")).toBeTruthy();
    expect(result.lobby.players.find((p) => p.id === "host")).toBeFalsy();
  });

  it("updates host reference", () => {
    create("host");
    const result = remapPlayer("host", "host-new")!;
    expect(result.lobby.hostId).toBe("host-new");
  });

  it("returns null for unknown socket", () => {
    expect(remapPlayer("nobody", "new")).toBeNull();
  });
});

// ── Bots ─────────────────────────────────────────────────────────────────────

describe("addBot / removeBot", () => {
  it("host can add a bot", () => {
    const code = create("host");
    const result = addBot("host");
    expect("botId" in result).toBe(true);
    expect(getBotsInLobby(code)).toHaveLength(1);
  });

  it("non-host cannot add a bot", () => {
    const code = create("host");
    join("p1", code);
    const result = addBot("p1");
    expect("error" in result).toBe(true);
  });

  it("host can remove a bot", () => {
    const code = create("host");
    const added = addBot("host") as any;
    const result = removeBot("host", added.botId);
    expect("error" in result).toBe(false);
    expect(getBotsInLobby(code)).toHaveLength(0);
  });

  it("cannot remove a non-bot player", () => {
    const code = create("host");
    join("p1", code);
    const result = removeBot("host", "p1");
    expect("error" in result).toBe(true);
  });

  it("isPlayerBot returns true for bots", () => {
    const code = create("host");
    const added = addBot("host") as any;
    expect(isPlayerBot(code, added.botId)).toBe(true);
    expect(isPlayerBot(code, "host")).toBe(false);
  });
});

// ── kickPlayer ───────────────────────────────────────────────────────────────

describe("kickPlayer", () => {
  it("host can kick a player", () => {
    const code = create("host");
    join("p1", code);
    const result = kickPlayer("host", "p1");
    expect("error" in result).toBe(false);
    expect(getLobbyPlayers(code)).not.toContain("p1");
  });

  it("non-host cannot kick", () => {
    const code = create("host");
    join("p1", code);
    const result = kickPlayer("p1", "host");
    expect("error" in result).toBe(true);
  });

  it("cannot kick yourself", () => {
    create("host");
    const result = kickPlayer("host", "host");
    expect("error" in result).toBe(true);
  });
});

// ── startGame ────────────────────────────────────────────────────────────────

describe("startGame", () => {
  it("host can start with 2+ players", () => {
    const code = create("host");
    join("p1", code);
    const result = startGame("host");
    expect("code" in result).toBe(true);
  });

  it("cannot start with only 1 player", () => {
    create("host");
    const result = startGame("host");
    expect("error" in result).toBe(true);
  });

  it("non-host cannot start", () => {
    const code = create("host");
    join("p1", code);
    const result = startGame("p1");
    expect("error" in result).toBe(true);
  });

  it("spectators don't count toward minimum", () => {
    const code = create("host");
    joinAsSpectator("spec1", code, "Spectator");
    const result = startGame("host");
    expect("error" in result).toBe(true);
  });
});

// ── changeLobbyDeck ──────────────────────────────────────────────────────────

describe("changeLobbyDeck", () => {
  it("host can change deck while waiting", () => {
    const code = create("host");
    const result = changeLobbyDeck("host", "d2", "New Deck", "cah", { mode: "points", value: 5 });
    expect("lobby" in result && result.lobby.deckName).toBe("New Deck");
    expect(getLobbyDeckId(code)).toBe("d2");
  });

  it("cannot change deck while playing", () => {
    const code = create("host");
    join("p1", code);
    startGame("host");
    const result = changeLobbyDeck("host", "d2", "New", "cah", { mode: "rounds", value: 5 });
    expect("error" in result).toBe(true);
  });
});

// ── setLobbyHouseRules ───────────────────────────────────────────────────────

describe("setLobbyHouseRules", () => {
  it("host can set house rules", () => {
    const code = create("host");
    setLobbyHouseRules("host", { unoStacking: true });
    expect(getLobbyHouseRules(code)).toEqual({ unoStacking: true });
  });

  it("non-host cannot set house rules", () => {
    const code = create("host");
    join("p1", code);
    const result = setLobbyHouseRules("p1", { unoStacking: true });
    expect("error" in result).toBe(true);
  });
});

// ── setMaxPlayers ────────────────────────────────────────────────────────────

describe("setMaxPlayers", () => {
  it("host can change max players", () => {
    create("host");
    const result = setMaxPlayers("host", 20) as any;
    expect(result.lobby.maxPlayers).toBe(20);
  });

  it("rejects values below 2 or above 50", () => {
    create("host");
    expect("error" in setMaxPlayers("host", 1)).toBe(true);
    expect("error" in setMaxPlayers("host", 51)).toBe(true);
  });

  it("cannot set below current player count", () => {
    const code = create("host");
    join("p1", code);
    join("p2", code);
    const result = setMaxPlayers("host", 2);
    expect("error" in result).toBe(true);
  });
});

// ── voteRematch / resetLobbyForRematch ───────────────────────────────────────

describe("rematch flow", () => {
  it("players can vote for rematch", () => {
    const code = create("host");
    join("p1", code);
    const result = voteRematch("host") as any;
    expect(result.voteCount).toBe(1);
    expect(result.totalPlayers).toBe(2);
  });

  it("host can reset lobby for rematch", () => {
    const code = create("host");
    join("p1", code);
    startGame("host");
    const result = resetLobbyForRematch("host") as any;
    expect(result.lobby.status).toBe("waiting");
    expect(result.lobby.players.every((p: any) => p.score === 0)).toBe(true);
  });

  it("non-host cannot reset for rematch", () => {
    const code = create("host");
    join("p1", code);
    const result = resetLobbyForRematch("p1");
    expect("error" in result).toBe(true);
  });
});

// ── Lookup helpers ───────────────────────────────────────────────────────────

describe("lookup helpers", () => {
  it("getLobbyForSocket returns code", () => {
    const code = create("host");
    expect(getLobbyForSocket("host")).toBe(code);
    expect(getLobbyForSocket("nobody")).toBeUndefined();
  });

  it("getPlayerNameInLobby returns name", () => {
    const code = create("host", "HostName");
    expect(getPlayerNameInLobby(code, "host")).toBe("HostName");
    expect(getPlayerNameInLobby(code, "nobody")).toBeUndefined();
  });

  it("getLobbyGameType returns game type", () => {
    const code = create("host");
    expect(getLobbyGameType(code)).toBe("cah");
  });
});
