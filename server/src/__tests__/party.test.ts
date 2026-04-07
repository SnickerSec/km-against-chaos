import { describe, it, expect, beforeEach } from "vitest";
import {
  createParty,
  joinParty,
  leaveParty,
  getPartyForUser,
  getPartyMembers,
  getPartySocketRoom,
  remapPartySocket,
  isInParty,
} from "../party.js";
import type { PartyState } from "../party.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Type guard: result is a PartyState (not an error). */
function isState(result: PartyState | { error: string }): result is PartyState {
  return !("error" in result);
}

/** Clean up a user from any party they're in. */
function cleanup(userId: string) {
  if (isInParty(userId)) leaveParty(userId);
}

const ALL_USERS = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9", "u10", "u11"];

beforeEach(() => {
  for (const u of ALL_USERS) cleanup(u);
});

// ── createParty ──────────────────────────────────────────────────────────────

describe("createParty", () => {
  it("creates a party and returns state", () => {
    const result = createParty("u1", "s1", "Alice");
    expect(isState(result)).toBe(true);
    if (!isState(result)) return;
    expect(result.id).toBeTruthy();
    expect(result.leaderId).toBe("u1");
    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toEqual({ userId: "u1", name: "Alice", picture: undefined });
  });

  it("creator is the leader", () => {
    const result = createParty("u1", "s1", "Alice");
    if (!isState(result)) return;
    expect(result.leaderId).toBe("u1");
  });

  it("includes picture when provided", () => {
    const result = createParty("u1", "s1", "Alice", "http://pic.jpg");
    if (!isState(result)) return;
    expect(result.members[0].picture).toBe("http://pic.jpg");
  });

  it("cannot create a second party while already in one", () => {
    createParty("u1", "s1", "Alice");
    const result = createParty("u1", "s2", "Alice");
    expect(isState(result)).toBe(false);
    if (isState(result)) return;
    expect(result.error).toMatch(/already in a party/i);
  });

  it("different users can create separate parties", () => {
    const r1 = createParty("u1", "s1", "Alice");
    const r2 = createParty("u2", "s2", "Bob");
    expect(isState(r1)).toBe(true);
    expect(isState(r2)).toBe(true);
    if (!isState(r1) || !isState(r2)) return;
    expect(r1.id).not.toBe(r2.id);
  });
});

// ── joinParty ────────────────────────────────────────────────────────────────

describe("joinParty", () => {
  it("user can join an existing party", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;

    const result = joinParty(created.id, "u2", "s2", "Bob");
    expect(isState(result)).toBe(true);
    if (!isState(result)) return;
    expect(result.members).toHaveLength(2);
    expect(result.members.map(m => m.userId)).toContain("u2");
  });

  it("leader does not change when someone joins", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;

    const result = joinParty(created.id, "u2", "s2", "Bob");
    if (!isState(result)) return;
    expect(result.leaderId).toBe("u1");
  });

  it("cannot join a non-existent party", () => {
    const result = joinParty("fake-id", "u1", "s1", "Alice");
    expect(isState(result)).toBe(false);
    if (isState(result)) return;
    expect(result.error).toMatch(/not found/i);
  });

  it("cannot join while already in a party", () => {
    const p1 = createParty("u1", "s1", "Alice");
    const p2 = createParty("u2", "s2", "Bob");
    if (!isState(p1) || !isState(p2)) return;

    const result = joinParty(p2.id, "u1", "s1", "Alice");
    expect(isState(result)).toBe(false);
    if (isState(result)) return;
    expect(result.error).toMatch(/already in a party/i);
  });

  it("party maxes out at 10 members", () => {
    const created = createParty("u1", "s1", "User1");
    if (!isState(created)) return;

    // Add 9 more members (total 10)
    for (let i = 2; i <= 10; i++) {
      const r = joinParty(created.id, `u${i}`, `s${i}`, `User${i}`);
      expect(isState(r)).toBe(true);
    }

    // 11th should fail
    const result = joinParty(created.id, "u11", "s11", "User11");
    expect(isState(result)).toBe(false);
    if (isState(result)) return;
    expect(result.error).toMatch(/full/i);
  });
});

// ── leaveParty ───────────────────────────────────────────────────────────────

describe("leaveParty", () => {
  it("member can leave a party", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;
    joinParty(created.id, "u2", "s2", "Bob");

    const result = leaveParty("u2");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.disbanded).toBe(false);
    expect(result.party).not.toBeNull();
    expect(result.party!.members.map(m => m.userId)).not.toContain("u2");
  });

  it("leaving when not in a party returns error", () => {
    const result = leaveParty("u1");
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toMatch(/not in a party/i);
  });

  it("last member leaving disbands the party", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;

    const result = leaveParty("u1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.disbanded).toBe(true);
    expect(result.party).toBeNull();
  });

  it("leader leaving transfers leadership to next member", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;
    joinParty(created.id, "u2", "s2", "Bob");
    joinParty(created.id, "u3", "s3", "Charlie");

    const result = leaveParty("u1");
    if ("error" in result) return;
    expect(result.party).not.toBeNull();
    // New leader should be one of the remaining members
    expect(["u2", "u3"]).toContain(result.party!.leaderId);
    expect(result.party!.leaderId).not.toBe("u1");
  });

  it("non-leader leaving doesn't change leadership", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;
    joinParty(created.id, "u2", "s2", "Bob");

    const result = leaveParty("u2");
    if ("error" in result) return;
    expect(result.party!.leaderId).toBe("u1");
  });

  it("returns the correct partyId", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;

    const result = leaveParty("u1");
    if ("error" in result) return;
    expect(result.partyId).toBe(created.id);
  });

  it("user is no longer in a party after leaving", () => {
    createParty("u1", "s1", "Alice");
    expect(isInParty("u1")).toBe(true);
    leaveParty("u1");
    expect(isInParty("u1")).toBe(false);
  });
});

// ── getPartyForUser ──────────────────────────────────────────────────────────

describe("getPartyForUser", () => {
  it("returns party state for a member", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;

    const state = getPartyForUser("u1");
    expect(state).not.toBeNull();
    expect(state!.id).toBe(created.id);
    expect(state!.leaderId).toBe("u1");
  });

  it("returns null for user not in a party", () => {
    expect(getPartyForUser("u1")).toBeNull();
  });

  it("reflects multiple members", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;
    joinParty(created.id, "u2", "s2", "Bob");

    const state = getPartyForUser("u2")!;
    expect(state.members).toHaveLength(2);
  });
});

// ── getPartyMembers ──────────────────────────────────────────────────────────

describe("getPartyMembers", () => {
  it("returns members with socket info", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;

    const members = getPartyMembers(created.id);
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe("u1");
    expect(members[0].socketId).toBe("s1");
    expect(members[0].name).toBe("Alice");
  });

  it("returns empty array for non-existent party", () => {
    expect(getPartyMembers("fake-id")).toEqual([]);
  });
});

// ── getPartySocketRoom ───────────────────────────────────────────────────────

describe("getPartySocketRoom", () => {
  it("returns prefixed room name", () => {
    expect(getPartySocketRoom("abc123")).toBe("party:abc123");
  });
});

// ── remapPartySocket ─────────────────────────────────────────────────────────

describe("remapPartySocket", () => {
  it("updates socket ID for a member", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;

    remapPartySocket("u1", "s1-new");

    const members = getPartyMembers(created.id);
    expect(members[0].socketId).toBe("s1-new");
  });

  it("no-op for user not in a party", () => {
    // Should not throw
    remapPartySocket("u1", "s1-new");
    expect(isInParty("u1")).toBe(false);
  });
});

// ── isInParty ────────────────────────────────────────────────────────────────

describe("isInParty", () => {
  it("returns true for party member", () => {
    createParty("u1", "s1", "Alice");
    expect(isInParty("u1")).toBe(true);
  });

  it("returns false for non-member", () => {
    expect(isInParty("u1")).toBe(false);
  });

  it("returns false after leaving", () => {
    createParty("u1", "s1", "Alice");
    leaveParty("u1");
    expect(isInParty("u1")).toBe(false);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("user can create a new party after leaving old one", () => {
    createParty("u1", "s1", "Alice");
    leaveParty("u1");

    const result = createParty("u1", "s1", "Alice");
    expect(isState(result)).toBe(true);
  });

  it("user can join a party after leaving another", () => {
    const p1 = createParty("u1", "s1", "Alice");
    const p2 = createParty("u2", "s2", "Bob");
    if (!isState(p1) || !isState(p2)) return;

    leaveParty("u1");
    const result = joinParty(p2.id, "u1", "s1", "Alice");
    expect(isState(result)).toBe(true);
  });

  it("disbanded party cannot be joined", () => {
    const created = createParty("u1", "s1", "Alice");
    if (!isState(created)) return;
    const partyId = created.id;
    leaveParty("u1"); // disbands

    const result = joinParty(partyId, "u2", "s2", "Bob");
    expect(isState(result)).toBe(false);
    if (isState(result)) return;
    expect(result.error).toMatch(/not found/i);
  });

  it("getPartyForUser returns null after party disbanded", () => {
    createParty("u1", "s1", "Alice");
    leaveParty("u1");
    expect(getPartyForUser("u1")).toBeNull();
  });
});
