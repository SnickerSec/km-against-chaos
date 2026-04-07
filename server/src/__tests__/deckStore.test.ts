import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock db before importing deckStore
vi.mock("../db.js", () => ({
  default: { query: vi.fn() },
}));

import pool from "../db.js";
const mockQuery = pool.query as ReturnType<typeof vi.fn>;

import {
  getDeck,
  createDeck,
  updateDeck,
  deleteDeck,
  listDecks,
  remixDeck,
  getPacksForDeck,
  getPackById,
  listPacks,
} from "../deckStore.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fake DB row that matches the decks table shape. */
function fakeRow(overrides: Record<string, any> = {}) {
  return {
    id: "deck-1",
    name: "Test Deck",
    description: "A test deck",
    chaos_cards: [{ id: "c1", text: "Q1", pick: 1 }],
    knowledge_cards: [{ id: "k1", text: "A1" }],
    win_condition: { mode: "rounds", value: 10 },
    built_in: false,
    owner_id: "owner-1",
    created_at: new Date("2025-01-01"),
    updated_at: new Date("2025-01-01"),
    maturity: "adult",
    flavor_themes: ["funny"],
    chaos_level: 3,
    wildcard: "twist",
    remixed_from: null,
    game_type: "cah",
    art_tier: "free",
    art_generation_status: null,
    draft: false,
    ...overrides,
  };
}

function fakeSummaryRow(overrides: Record<string, any> = {}) {
  return {
    id: "deck-1",
    name: "Test Deck",
    description: "A test deck",
    built_in: false,
    win_condition: { mode: "rounds", value: 10 },
    owner_id: "owner-1",
    owner_name: "Alice",
    maturity: "adult",
    flavor_themes: ["funny"],
    chaos_level: 3,
    wildcard: "",
    remixed_from: null,
    game_type: "cah",
    play_count: "5",
    avg_rating: "4.2",
    chaos_count: "10",
    knowledge_count: "30",
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
});

// ── getDeck ──────────────────────────────────────────────────────────────────

describe("getDeck", () => {
  it("returns a deck when found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()] });

    const deck = await getDeck("deck-1");
    expect(deck).not.toBeNull();
    expect(deck!.id).toBe("deck-1");
    expect(deck!.name).toBe("Test Deck");
    expect(deck!.chaosCards).toEqual([{ id: "c1", text: "Q1", pick: 1 }]);
    expect(deck!.ownerId).toBe("owner-1");
    expect(deck!.gameType).toBe("cah");
  });

  it("returns null when not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const deck = await getDeck("nonexistent");
    expect(deck).toBeNull();
  });

  it("applies default win condition when missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow({ win_condition: null })] });
    const deck = await getDeck("deck-1");
    expect(deck!.winCondition).toEqual({ mode: "rounds", value: 10 });
  });

  it("applies defaults for missing optional fields", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeRow({
        maturity: null,
        flavor_themes: null,
        chaos_level: null,
        wildcard: null,
        game_type: null,
        art_tier: null,
        owner_id: null,
      })],
    });
    const deck = await getDeck("deck-1");
    expect(deck!.maturity).toBe("adult");
    expect(deck!.flavorThemes).toEqual([]);
    expect(deck!.chaosLevel).toBe(0);
    expect(deck!.wildcard).toBe("");
    expect(deck!.gameType).toBe("cah");
    expect(deck!.artTier).toBe("free");
    expect(deck!.ownerId).toBeNull();
  });

  it("returns null on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection lost"));
    const deck = await getDeck("deck-1");
    expect(deck).toBeNull();
  });
});

// ── createDeck ───────────────────────────────────────────────────────────────

describe("createDeck", () => {
  it("creates a deck and returns it", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()] });

    const deck = await createDeck({
      name: "  Test Deck  ",
      description: "  A test deck  ",
      chaosCards: [{ text: "  Q1  ", pick: 2 }],
      knowledgeCards: [{ text: "  A1  " }],
      ownerId: "owner-1",
    });

    expect(deck.name).toBe("Test Deck");
    expect(mockQuery).toHaveBeenCalledOnce();

    // Verify the INSERT params
    const params = mockQuery.mock.calls[0][1];
    expect(params[1]).toBe("Test Deck"); // name trimmed
    expect(params[2]).toBe("A test deck"); // description trimmed
  });

  it("trims card text", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()] });

    await createDeck({
      name: "Deck",
      chaosCards: [{ text: "  prompt  " }],
      knowledgeCards: [{ text: "  answer  " }],
    });

    const params = mockQuery.mock.calls[0][1];
    const chaosCards = JSON.parse(params[3]);
    const knowledgeCards = JSON.parse(params[4]);
    expect(chaosCards[0].text).toBe("prompt");
    expect(knowledgeCards[0].text).toBe("answer");
  });

  it("assigns IDs to cards", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()] });

    await createDeck({
      name: "Deck",
      chaosCards: [{ text: "Q1" }, { text: "Q2" }],
      knowledgeCards: [{ text: "A1" }],
    });

    const params = mockQuery.mock.calls[0][1];
    const chaosCards = JSON.parse(params[3]);
    expect(chaosCards[0].id).toMatch(/^cc-/);
    expect(chaosCards[1].id).toMatch(/^cc-/);
    expect(chaosCards[0].id).not.toBe(chaosCards[1].id);
  });

  it("defaults pick to 1", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()] });

    await createDeck({
      name: "Deck",
      chaosCards: [{ text: "Q1" }], // no pick specified
      knowledgeCards: [{ text: "A1" }],
    });

    const params = mockQuery.mock.calls[0][1];
    const chaosCards = JSON.parse(params[3]);
    expect(chaosCards[0].pick).toBe(1);
  });

  it("preserves meta effects on chaos cards", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()] });

    await createDeck({
      name: "Deck",
      chaosCards: [{ text: "Q1", metaType: "swap", metaEffect: { type: "score_add", value: 2 }, bonus: true }],
      knowledgeCards: [{ text: "A1" }],
    });

    const params = mockQuery.mock.calls[0][1];
    const chaosCards = JSON.parse(params[3]);
    expect(chaosCards[0].metaType).toBe("swap");
    expect(chaosCards[0].metaEffect).toEqual({ type: "score_add", value: 2 });
    expect(chaosCards[0].bonus).toBe(true);
  });

  it("uses default win condition when not provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()] });

    await createDeck({
      name: "Deck",
      chaosCards: [{ text: "Q1" }],
      knowledgeCards: [{ text: "A1" }],
    });

    const params = mockQuery.mock.calls[0][1];
    const winCondition = JSON.parse(params[5]);
    expect(winCondition).toEqual({ mode: "rounds", value: 10 });
  });

  it("uses provided win condition", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()] });

    await createDeck({
      name: "Deck",
      chaosCards: [{ text: "Q1" }],
      knowledgeCards: [{ text: "A1" }],
      winCondition: { mode: "points", value: 5 },
    });

    const params = mockQuery.mock.calls[0][1];
    const winCondition = JSON.parse(params[5]);
    expect(winCondition).toEqual({ mode: "points", value: 5 });
  });

  it("stores recipe fields", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()] });

    await createDeck({
      name: "Deck",
      chaosCards: [{ text: "Q1" }],
      knowledgeCards: [{ text: "A1" }],
      maturity: "family",
      flavorThemes: ["sci-fi", "horror"],
      chaosLevel: 7,
      wildcard: "banana",
      gameType: "joking_hazard",
    });

    const params = mockQuery.mock.calls[0][1];
    expect(params[7]).toBe("family");                           // maturity
    expect(JSON.parse(params[8])).toEqual(["sci-fi", "horror"]); // flavorThemes
    expect(params[9]).toBe(7);                                   // chaosLevel
    expect(params[10]).toBe("banana");                           // wildcard
    expect(params[12]).toBe("joking_hazard");                    // gameType
  });
});

// ── updateDeck ───────────────────────────────────────────────────────────────

describe("updateDeck", () => {
  it("updates a deck owned by the user", async () => {
    // First call: getDeck
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()] });
    // Second call: UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow({ name: "Updated" })] });

    const deck = await updateDeck("deck-1", { name: "Updated" }, "owner-1");
    expect(deck).not.toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns null when deck not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const deck = await updateDeck("nonexistent", { name: "Updated" }, "owner-1");
    expect(deck).toBeNull();
  });

  it("returns null when owner doesn't match", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow({ owner_id: "other-owner" })] });
    const deck = await updateDeck("deck-1", { name: "Updated" }, "wrong-owner");
    expect(deck).toBeNull();
    // Should not have called UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("bypassOwnership allows any user to update", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow({ owner_id: "other-owner" })] });
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow({ name: "Updated" })] });

    const deck = await updateDeck("deck-1", { name: "Updated" }, "wrong-owner", true);
    expect(deck).not.toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns null when UPDATE returns no rows", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE matched nothing

    const deck = await updateDeck("deck-1", { name: "Updated" }, "owner-1");
    expect(deck).toBeNull();
  });

  it("preserves existing fields when not provided in input", async () => {
    const existing = fakeRow({ name: "Original", description: "Original desc" });
    mockQuery.mockResolvedValueOnce({ rows: [existing] });
    mockQuery.mockResolvedValueOnce({ rows: [existing] });

    await updateDeck("deck-1", {}, "owner-1"); // empty update

    const updateParams = mockQuery.mock.calls[1][1];
    expect(updateParams[0]).toBe("Original");      // name preserved
    expect(updateParams[1]).toBe("Original desc");  // description preserved
  });
});

// ── deleteDeck ───────────────────────────────────────────────────────────────

describe("deleteDeck", () => {
  it("deletes and returns true when successful", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const result = await deleteDeck("deck-1", "owner-1");
    expect(result).toBe(true);
  });

  it("returns false when no rows deleted", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const result = await deleteDeck("deck-1", "owner-1");
    expect(result).toBe(false);
  });

  it("includes owner_id in query when not bypassing", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await deleteDeck("deck-1", "owner-1");
    expect(mockQuery.mock.calls[0][1]).toEqual(["deck-1", "owner-1"]);
  });

  it("bypassOwnership omits owner_id from query", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await deleteDeck("deck-1", undefined, true);
    expect(mockQuery.mock.calls[0][1]).toEqual(["deck-1"]);
  });

  it("handles null rowCount", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null });
    const result = await deleteDeck("deck-1", "owner-1");
    expect(result).toBe(false);
  });
});

// ── listDecks ────────────────────────────────────────────────────────────────

describe("listDecks", () => {
  it("returns deck summaries", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeSummaryRow()] });

    const decks = await listDecks();
    expect(decks).toHaveLength(1);
    expect(decks[0].name).toBe("Test Deck");
    expect(decks[0].chaosCount).toBe(10);
    expect(decks[0].knowledgeCount).toBe(30);
    expect(decks[0].ownerName).toBe("Alice");
    expect(decks[0].playCount).toBe(5);
    expect(decks[0].avgRating).toBeCloseTo(4.2);
  });

  it("passes search parameter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listDecks({ search: "funny" });
    const query = mockQuery.mock.calls[0][0];
    const params = mockQuery.mock.calls[0][1];
    expect(query).toContain("ILIKE");
    expect(params).toContain("%funny%");
  });

  it("passes gameType filter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listDecks({ gameType: "uno" });
    const params = mockQuery.mock.calls[0][1];
    expect(params).toContain("uno");
  });

  it("passes maturity filter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listDecks({ maturity: "family" });
    const params = mockQuery.mock.calls[0][1];
    expect(params).toContain("family");
  });

  it("sort=popular orders by play_count", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listDecks({ sort: "popular" });
    const query = mockQuery.mock.calls[0][0];
    expect(query).toContain("play_count");
  });

  it("sort=rating orders by avg_rating", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listDecks({ sort: "rating" });
    const query = mockQuery.mock.calls[0][0];
    expect(query).toContain("avg_rating");
  });

  it("returns empty array on DB error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB down"));
    const decks = await listDecks();
    expect(decks).toEqual([]); // falls back to built-in which is empty
  });
});

// ── remixDeck ────────────────────────────────────────────────────────────────

describe("remixDeck", () => {
  it("creates a remix with source reference", async () => {
    // getDeck call
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow({ name: "Original" })] });
    // createDeck INSERT call
    mockQuery.mockResolvedValueOnce({
      rows: [fakeRow({ name: "Remix of Original", remixed_from: "deck-1" })],
    });

    const deck = await remixDeck("deck-1", "new-owner");
    expect(deck.name).toBe("Remix of Original");
    expect(deck.remixedFrom).toBe("deck-1");
  });

  it("throws when source deck not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(remixDeck("nonexistent", "owner")).rejects.toThrow(/not found/i);
  });
});

// ── Pack operations ──────────────────────────────────────────────────────────

describe("getPacksForDeck", () => {
  it("returns packs with normalized cards", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        type: "expansion",
        name: "Pack 1",
        description: "Desc",
        chaos_cards: [{ text: "Q1", pick: 2 }],
        knowledge_cards: [{ text: "A1", bonus: true }],
      }],
    });

    const packs = await getPacksForDeck("deck-1");
    expect(packs).toHaveLength(1);
    expect(packs[0].chaosCards[0]).toEqual({ text: "Q1", pick: 2 });
    expect(packs[0].knowledgeCards[0]).toEqual({ text: "A1", bonus: true });
  });

  it("defaults pick to 1 for cards missing it", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        type: "expansion",
        name: "Pack",
        description: "",
        chaos_cards: [{ text: "Q1" }], // no pick
        knowledge_cards: [],
      }],
    });

    const packs = await getPacksForDeck("deck-1");
    expect(packs[0].chaosCards[0].pick).toBe(1);
  });

  it("handles null cards arrays", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        type: "expansion",
        name: "Pack",
        description: "",
        chaos_cards: null,
        knowledge_cards: null,
      }],
    });

    const packs = await getPacksForDeck("deck-1");
    expect(packs[0].chaosCards).toEqual([]);
    expect(packs[0].knowledgeCards).toEqual([]);
  });
});

describe("getPackById", () => {
  it("returns pack when found", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "pack-1",
        type: "expansion",
        name: "Pack 1",
        description: "Desc",
        chaos_cards: [{ id: "c1", text: "Q1" }],
        knowledge_cards: [{ id: "k1", text: "A1" }],
      }],
    });

    const pack = await getPackById("pack-1");
    expect(pack).not.toBeNull();
    expect(pack!.id).toBe("pack-1");
    expect(pack!.name).toBe("Pack 1");
  });

  it("returns null when not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const pack = await getPackById("nonexistent");
    expect(pack).toBeNull();
  });
});

describe("listPacks", () => {
  it("returns pack summaries", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "pack-1",
        deck_id: "deck-1",
        deck_name: "My Deck",
        type: "expansion",
        name: "Pack 1",
        description: "Desc",
        owner_id: "owner-1",
        built_in: false,
        chaos_count: "5",
        knowledge_count: "10",
      }],
    });

    const packs = await listPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0].deckName).toBe("My Deck");
    expect(packs[0].chaosCount).toBe(5);
    expect(packs[0].knowledgeCount).toBe(10);
  });

  it("filters by type when provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listPacks("expansion");
    const params = mockQuery.mock.calls[0][1];
    expect(params).toEqual(["expansion"]);
  });

  it("no type filter when not provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listPacks();
    const params = mockQuery.mock.calls[0][1];
    expect(params).toEqual([]);
  });
});
