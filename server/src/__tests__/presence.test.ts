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
async function cleanUser(userId: string, socketIds: string[]) {
  for (const sid of socketIds) await setOffline(userId, sid);
}

beforeEach(async () => {
  // Clean up known test users
  await cleanUser("u1", ["s1", "s1a", "s1b", "s1-new"]);
  await cleanUser("u2", ["s2"]);
  await cleanUser("u3", ["s3"]);
});

// ── setOnline / isOnline ─────────────────────────────────────────────────────

describe("setOnline", () => {
  it("makes a user online", async () => {
    await setOnline("u1", "s1");
    expect(await isOnline("u1")).toBe(true);
  });

  it("user with no sockets is offline", async () => {
    expect(await isOnline("u1")).toBe(false);
  });

  it("multiple sockets for same user", async () => {
    await setOnline("u1", "s1a");
    await setOnline("u1", "s1b");
    expect(await isOnline("u1")).toBe(true);
    const sockets = await getSocketIdsForUser("u1");
    expect(sockets.size).toBe(2);
    expect(sockets.has("s1a")).toBe(true);
    expect(sockets.has("s1b")).toBe(true);
  });
});

// ── setOffline ───────────────────────────────────────────────────────────────

describe("setOffline", () => {
  it("returns true when user goes fully offline", async () => {
    await setOnline("u1", "s1");
    const fullyOffline = await setOffline("u1", "s1");
    expect(fullyOffline).toBe(true);
    expect(await isOnline("u1")).toBe(false);
  });

  it("returns false when user still has other sockets", async () => {
    await setOnline("u1", "s1a");
    await setOnline("u1", "s1b");
    const fullyOffline = await setOffline("u1", "s1a");
    expect(fullyOffline).toBe(false);
    expect(await isOnline("u1")).toBe(true);
  });

  it("returns true for unknown user", async () => {
    const result = await setOffline("unknown", "s99");
    expect(result).toBe(true);
  });

  it("clears socket-to-user mapping", async () => {
    await setOnline("u1", "s1");
    expect(await getUserIdForSocket("s1")).toBe("u1");
    await setOffline("u1", "s1");
    expect(await getUserIdForSocket("s1")).toBeUndefined();
  });
});

// ── setInGame / setNotInGame ─────────────────────────────────────────────────

describe("setInGame / setNotInGame", () => {
  it("sets in_game status with lobby code", async () => {
    await setOnline("u1", "s1");
    await setInGame("u1", "ABCD", "My Deck");

    const presence = await getPresence("u1");
    expect(presence.status).toBe("in_game");
    expect(presence.lobbyCode).toBe("ABCD");
    expect(presence.deckName).toBe("My Deck");
  });

  it("setNotInGame resets to online", async () => {
    await setOnline("u1", "s1");
    await setInGame("u1", "ABCD");
    await setNotInGame("u1");

    const presence = await getPresence("u1");
    expect(presence.status).toBe("online");
    expect(presence.lobbyCode).toBeUndefined();
    expect(presence.deckName).toBeUndefined();
  });

  it("setInGame is a no-op for offline user", async () => {
    await setInGame("u1", "ABCD");
    expect((await getPresence("u1")).status).toBe("offline");
  });

  it("setNotInGame is a no-op for offline user", async () => {
    await setNotInGame("u1");
    expect((await getPresence("u1")).status).toBe("offline");
  });

  it("deckName is optional", async () => {
    await setOnline("u1", "s1");
    await setInGame("u1", "ABCD");
    const presence = await getPresence("u1");
    expect(presence.lobbyCode).toBe("ABCD");
    expect(presence.deckName).toBeUndefined();
  });
});

// ── getPresence ──────────────────────────────────────────────────────────────

describe("getPresence", () => {
  it("offline for unknown user", async () => {
    expect(await getPresence("unknown")).toEqual({ status: "offline" });
  });

  it("online after setOnline", async () => {
    await setOnline("u1", "s1");
    expect((await getPresence("u1")).status).toBe("online");
  });

  it("in_game after setInGame", async () => {
    await setOnline("u1", "s1");
    await setInGame("u1", "LOBBY");
    expect((await getPresence("u1")).status).toBe("in_game");
  });
});

// ── getPresenceBulk ──────────────────────────────────────────────────────────

describe("getPresenceBulk", () => {
  it("returns presence for multiple users", async () => {
    await setOnline("u1", "s1");
    await setOnline("u2", "s2");
    await setInGame("u2", "LOBBY");

    const bulk = await getPresenceBulk(["u1", "u2", "u3"]);
    expect(bulk.get("u1")!.status).toBe("online");
    expect(bulk.get("u2")!.status).toBe("in_game");
    expect(bulk.get("u3")!.status).toBe("offline");
  });

  it("empty input returns empty map", async () => {
    const bulk = await getPresenceBulk([]);
    expect(bulk.size).toBe(0);
  });
});

// ── getUserIdForSocket / getSocketIdsForUser ─────────────────────────────────

describe("getUserIdForSocket", () => {
  it("returns userId for known socket", async () => {
    await setOnline("u1", "s1");
    expect(await getUserIdForSocket("s1")).toBe("u1");
  });

  it("returns undefined for unknown socket", async () => {
    expect(await getUserIdForSocket("s99")).toBeUndefined();
  });
});

describe("getSocketIdsForUser", () => {
  it("returns all sockets for a user", async () => {
    await setOnline("u1", "s1a");
    await setOnline("u1", "s1b");
    const sockets = await getSocketIdsForUser("u1");
    expect(sockets).toEqual(new Set(["s1a", "s1b"]));
  });

  it("returns empty set for unknown user", async () => {
    expect((await getSocketIdsForUser("unknown")).size).toBe(0);
  });
});

// ── remapSocket ──────────────────────────────────────────────────────────────

describe("remapSocket", () => {
  it("remaps socket ID preserving user association", async () => {
    await setOnline("u1", "s1");
    await remapSocket("s1", "s1-new");

    expect(await getUserIdForSocket("s1")).toBeUndefined();
    expect(await getUserIdForSocket("s1-new")).toBe("u1");
    expect((await getSocketIdsForUser("u1")).has("s1-new")).toBe(true);
    expect((await getSocketIdsForUser("u1")).has("s1")).toBe(false);
  });

  it("no-op for unknown socket", async () => {
    await remapSocket("unknown", "new");
    expect(await getUserIdForSocket("new")).toBeUndefined();
  });

  it("preserves presence status after remap", async () => {
    await setOnline("u1", "s1");
    await setInGame("u1", "LOBBY", "Deck");
    await remapSocket("s1", "s1-new");

    const presence = await getPresence("u1");
    expect(presence.status).toBe("in_game");
    expect(presence.lobbyCode).toBe("LOBBY");
  });
});
