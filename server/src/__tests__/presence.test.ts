import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock db before importing presence (pool.query is fire-and-forget in setOffline)
vi.mock("../db.js", () => ({
  default: { query: vi.fn().mockResolvedValue({}) },
}));

import {
  setOnline,
  setOffline,
  setInGame,
  setNotInGame,
  getPresence,
  getPresenceBulk,
  getUserIdForSocket,
  getSocketIdsForUser,
  isOnline,
  remapSocket,
} from "../presence.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Clean up a user by removing all known sockets. */
function cleanUser(userId: string, socketIds: string[]) {
  for (const sid of socketIds) setOffline(userId, sid);
}

beforeEach(() => {
  // Clean up known test users
  cleanUser("u1", ["s1", "s1a", "s1b", "s1-new"]);
  cleanUser("u2", ["s2"]);
  cleanUser("u3", ["s3"]);
});

// ── setOnline / isOnline ─────────────────────────────────────────────────────

describe("setOnline", () => {
  it("makes a user online", () => {
    setOnline("u1", "s1");
    expect(isOnline("u1")).toBe(true);
  });

  it("user with no sockets is offline", () => {
    expect(isOnline("u1")).toBe(false);
  });

  it("multiple sockets for same user", () => {
    setOnline("u1", "s1a");
    setOnline("u1", "s1b");
    expect(isOnline("u1")).toBe(true);
    const sockets = getSocketIdsForUser("u1");
    expect(sockets.size).toBe(2);
    expect(sockets.has("s1a")).toBe(true);
    expect(sockets.has("s1b")).toBe(true);
  });
});

// ── setOffline ───────────────────────────────────────────────────────────────

describe("setOffline", () => {
  it("returns true when user goes fully offline", () => {
    setOnline("u1", "s1");
    const fullyOffline = setOffline("u1", "s1");
    expect(fullyOffline).toBe(true);
    expect(isOnline("u1")).toBe(false);
  });

  it("returns false when user still has other sockets", () => {
    setOnline("u1", "s1a");
    setOnline("u1", "s1b");
    const fullyOffline = setOffline("u1", "s1a");
    expect(fullyOffline).toBe(false);
    expect(isOnline("u1")).toBe(true);
  });

  it("returns true for unknown user", () => {
    const result = setOffline("unknown", "s99");
    expect(result).toBe(true);
  });

  it("clears socket-to-user mapping", () => {
    setOnline("u1", "s1");
    expect(getUserIdForSocket("s1")).toBe("u1");
    setOffline("u1", "s1");
    expect(getUserIdForSocket("s1")).toBeUndefined();
  });
});

// ── setInGame / setNotInGame ─────────────────────────────────────────────────

describe("setInGame / setNotInGame", () => {
  it("sets in_game status with lobby code", () => {
    setOnline("u1", "s1");
    setInGame("u1", "ABCD", "My Deck");

    const presence = getPresence("u1");
    expect(presence.status).toBe("in_game");
    expect(presence.lobbyCode).toBe("ABCD");
    expect(presence.deckName).toBe("My Deck");
  });

  it("setNotInGame resets to online", () => {
    setOnline("u1", "s1");
    setInGame("u1", "ABCD");
    setNotInGame("u1");

    const presence = getPresence("u1");
    expect(presence.status).toBe("online");
    expect(presence.lobbyCode).toBeUndefined();
    expect(presence.deckName).toBeUndefined();
  });

  it("setInGame is a no-op for offline user", () => {
    setInGame("u1", "ABCD");
    expect(getPresence("u1").status).toBe("offline");
  });

  it("setNotInGame is a no-op for offline user", () => {
    setNotInGame("u1");
    expect(getPresence("u1").status).toBe("offline");
  });

  it("deckName is optional", () => {
    setOnline("u1", "s1");
    setInGame("u1", "ABCD");
    const presence = getPresence("u1");
    expect(presence.lobbyCode).toBe("ABCD");
    expect(presence.deckName).toBeUndefined();
  });
});

// ── getPresence ──────────────────────────────────────────────────────────────

describe("getPresence", () => {
  it("offline for unknown user", () => {
    expect(getPresence("unknown")).toEqual({ status: "offline" });
  });

  it("online after setOnline", () => {
    setOnline("u1", "s1");
    expect(getPresence("u1").status).toBe("online");
  });

  it("in_game after setInGame", () => {
    setOnline("u1", "s1");
    setInGame("u1", "LOBBY");
    expect(getPresence("u1").status).toBe("in_game");
  });
});

// ── getPresenceBulk ──────────────────────────────────────────────────────────

describe("getPresenceBulk", () => {
  it("returns presence for multiple users", () => {
    setOnline("u1", "s1");
    setOnline("u2", "s2");
    setInGame("u2", "LOBBY");

    const bulk = getPresenceBulk(["u1", "u2", "u3"]);
    expect(bulk.get("u1")!.status).toBe("online");
    expect(bulk.get("u2")!.status).toBe("in_game");
    expect(bulk.get("u3")!.status).toBe("offline");
  });

  it("empty input returns empty map", () => {
    const bulk = getPresenceBulk([]);
    expect(bulk.size).toBe(0);
  });
});

// ── getUserIdForSocket / getSocketIdsForUser ─────────────────────────────────

describe("getUserIdForSocket", () => {
  it("returns userId for known socket", () => {
    setOnline("u1", "s1");
    expect(getUserIdForSocket("s1")).toBe("u1");
  });

  it("returns undefined for unknown socket", () => {
    expect(getUserIdForSocket("s99")).toBeUndefined();
  });
});

describe("getSocketIdsForUser", () => {
  it("returns all sockets for a user", () => {
    setOnline("u1", "s1a");
    setOnline("u1", "s1b");
    const sockets = getSocketIdsForUser("u1");
    expect(sockets).toEqual(new Set(["s1a", "s1b"]));
  });

  it("returns empty set for unknown user", () => {
    expect(getSocketIdsForUser("unknown").size).toBe(0);
  });
});

// ── remapSocket ──────────────────────────────────────────────────────────────

describe("remapSocket", () => {
  it("remaps socket ID preserving user association", () => {
    setOnline("u1", "s1");
    remapSocket("s1", "s1-new");

    expect(getUserIdForSocket("s1")).toBeUndefined();
    expect(getUserIdForSocket("s1-new")).toBe("u1");
    expect(getSocketIdsForUser("u1").has("s1-new")).toBe(true);
    expect(getSocketIdsForUser("u1").has("s1")).toBe(false);
  });

  it("no-op for unknown socket", () => {
    remapSocket("unknown", "new");
    expect(getUserIdForSocket("new")).toBeUndefined();
  });

  it("preserves presence status after remap", () => {
    setOnline("u1", "s1");
    setInGame("u1", "LOBBY", "Deck");
    remapSocket("s1", "s1-new");

    const presence = getPresence("u1");
    expect(presence.status).toBe("in_game");
    expect(presence.lobbyCode).toBe("LOBBY");
  });
});
