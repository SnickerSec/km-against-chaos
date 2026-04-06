import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isValidPlay, createUnoGame, getUnoPlayerView, cleanupUnoGame } from "../unoGame.js";
import type { UnoCard, UnoColor, UnoDeckTemplate } from "../types.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const card = (
  id: string,
  color: UnoColor | null,
  type: UnoCard["type"],
  value: number | null = null
): UnoCard => ({ id, color, type, value, text: id });

const red5    = card("r5",  "red",  "number", 5);
const blue5   = card("b5",  "blue", "number", 5);
const red3    = card("r3",  "red",  "number", 3);
const blue3   = card("b3",  "blue", "number", 3);
const redSkip = card("rs",  "red",  "skip");
const bluSkip = card("bs",  "blue", "skip");
const redDT   = card("rdt", "red",  "draw_two");
const bluDT   = card("bdt", "blue", "draw_two");
const wild    = card("w",   null,   "wild");
const wDF4    = card("w4",  null,   "wild_draw_four");

// ── isValidPlay ──────────────────────────────────────────────────────────────

describe("isValidPlay — no pending draw", () => {
  it("wild is always playable", () => {
    expect(isValidPlay(wild, red5, "red", 0)).toBe(true);
    expect(isValidPlay(wild, blue5, "green", 0)).toBe(true);
  });

  it("wild_draw_four is always playable", () => {
    expect(isValidPlay(wDF4, red5, "red", 0)).toBe(true);
    expect(isValidPlay(wDF4, blue3, "yellow", 0)).toBe(true);
  });

  it("matches on active color", () => {
    expect(isValidPlay(red3, blue5, "red", 0)).toBe(true);   // red matches active color red
    expect(isValidPlay(red3, blue5, "blue", 0)).toBe(false); // red doesn't match active color blue
  });

  it("matches on number", () => {
    expect(isValidPlay(blue5, red5, "red", 0)).toBe(true);   // 5 == 5
    expect(isValidPlay(blue3, red5, "red", 0)).toBe(false);  // 3 != 5, wrong color
  });

  it("matches on action type", () => {
    expect(isValidPlay(bluSkip, redSkip, "red", 0)).toBe(true);  // skip == skip
    expect(isValidPlay(bluSkip, red5,    "red", 0)).toBe(false); // skip != number
    expect(isValidPlay(bluDT,   redDT,   "red", 0)).toBe(true);  // draw_two == draw_two
  });
});

describe("isValidPlay — pending draw (stacking disabled)", () => {
  it("blocks all cards when stacking is off", () => {
    expect(isValidPlay(red3,  redDT, "red",  2, false)).toBe(false);
    expect(isValidPlay(wild,  redDT, "red",  2, false)).toBe(false);
    expect(isValidPlay(wDF4,  redDT, "red",  2, false)).toBe(false);
    expect(isValidPlay(bluDT, redDT, "red",  2, false)).toBe(false);
  });
});

describe("isValidPlay — pending draw (stacking enabled)", () => {
  it("allows draw_two on draw_two", () => {
    expect(isValidPlay(bluDT, redDT, "red", 2, true)).toBe(true);
    expect(isValidPlay(red3,  redDT, "red", 2, true)).toBe(false); // not a draw_two
  });

  it("allows wild_draw_four on any pending draw", () => {
    expect(isValidPlay(wDF4, redDT, "red", 2, true)).toBe(true);
    expect(isValidPlay(wDF4, wDF4,  "red", 4, true)).toBe(true);
  });

  it("blocks wild (not wild_draw_four) when stacking", () => {
    expect(isValidPlay(wild, redDT, "red", 2, true)).toBe(false);
  });
});

// ── Deck generation ──────────────────────────────────────────────────────────

const TEMPLATE: UnoDeckTemplate = {
  colorNames: { red: "Fire", blue: "Water", green: "Forest", yellow: "Sand" },
  actionNames: { skip: "Freeze", reverse: "Flip", draw_two: "Burn Two", wild: "Chaos", wild_draw_four: "Chaos Four" },
};

describe("generateUnoDeck (via createUnoGame)", () => {
  const LOBBY = "test-deck-gen";
  const PLAYERS = ["a", "b", "c"];

  beforeEach(() => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
  });
  afterEach(() => {
    cleanupUnoGame(LOBBY);
  });

  it("deals at least 7 cards to each player", () => {
    for (const pid of PLAYERS) {
      const view = getUnoPlayerView(LOBBY, pid);
      // First player may get +2 if the starting card is draw_two
      expect(view?.hand.length).toBeGreaterThanOrEqual(7);
    }
  });

  it("each player's hand uses the custom color names", () => {
    const view = getUnoPlayerView(LOBBY, "a")!;
    const colorLabels = new Set(
      view.hand.filter(c => c.color !== null).map(c => c.colorLabel)
    );
    // All colorLabels should be one of our custom names
    for (const label of colorLabels) {
      expect(["Fire", "Water", "Forest", "Sand"]).toContain(label);
    }
  });
});
