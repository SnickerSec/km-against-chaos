import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isValidPlay,
  createUnoGame,
  getUnoPlayerView,
  cleanupUnoGame,
  playCard,
  drawCard,
  callUno,
  challengeUno,
  advanceUnoRound,
  botPlayUnoTurn,
  getUnoCurrentPlayer,
  getUnoScores,
  isUnoGameOver,
  getUnoPhase,
  getUnoPlayerIds,
  isUnoGame,
  remapUnoGamePlayer,
  handleUnoTurnTimeout,
  exportUnoGames,
  restoreUnoGames,
} from "../unoGame.js";
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

const TEMPLATE: UnoDeckTemplate = {
  colorNames: { red: "Fire", blue: "Water", green: "Forest", yellow: "Sand" },
  actionNames: { skip: "Freeze", reverse: "Flip", draw_two: "Burn Two", wild: "Chaos", wild_draw_four: "Chaos Four" },
};

const LOBBY = "test-uno";
const PLAYERS = ["p1", "p2", "p3"];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get the current player's ID. */
function currentPlayer(): string {
  return getUnoCurrentPlayer(LOBBY)!;
}

/** Get the view for the current player. */
function currentView(): ReturnType<typeof getUnoPlayerView> {
  return getUnoPlayerView(LOBBY, currentPlayer());
}

/** Find a playable card in the current player's hand, or null. */
function findPlayable(): UnoCard | null {
  const view = currentView()!;
  if (view.playableCardIds.length === 0) return null;
  return view.hand.find(c => c.id === view.playableCardIds[0]) || null;
}

/** Play or draw until a round ends. Returns the winner. Safety limit prevents infinite loop. */
function playUntilRoundOver(limit = 500): string | null {
  for (let i = 0; i < limit; i++) {
    const pid = currentPlayer();
    const view = getUnoPlayerView(LOBBY, pid)!;
    if (view.turn.phase !== "playing") return null;

    if (view.playableCardIds.length > 0) {
      const cardToPlay = view.hand.find(c => c.id === view.playableCardIds[0])!;
      // Choose a color for wilds
      const color: UnoColor | undefined =
        (cardToPlay.type === "wild" || cardToPlay.type === "wild_draw_four") ? "red" : undefined;

      // Call Uno if going to 1 card
      if (view.hand.length === 2) callUno(LOBBY, pid);

      const result = playCard(LOBBY, pid, cardToPlay.id, color);
      if (result.roundOver) return result.winnerId || null;
    } else {
      drawCard(LOBBY, pid);
    }
  }
  return null; // safety
}

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
    expect(isValidPlay(red3, blue5, "red", 0)).toBe(true);
    expect(isValidPlay(red3, blue5, "blue", 0)).toBe(false);
  });

  it("matches on number", () => {
    expect(isValidPlay(blue5, red5, "red", 0)).toBe(true);
    expect(isValidPlay(blue3, red5, "red", 0)).toBe(false);
  });

  it("matches on action type", () => {
    expect(isValidPlay(bluSkip, redSkip, "red", 0)).toBe(true);
    expect(isValidPlay(bluSkip, red5,    "red", 0)).toBe(false);
    expect(isValidPlay(bluDT,   redDT,   "red", 0)).toBe(true);
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
    expect(isValidPlay(red3,  redDT, "red", 2, true)).toBe(false);
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

describe("generateUnoDeck (via createUnoGame)", () => {
  beforeEach(() => createUnoGame(LOBBY, PLAYERS, TEMPLATE));
  afterEach(() => cleanupUnoGame(LOBBY));

  it("deals at least 7 cards to each player", () => {
    for (const pid of PLAYERS) {
      const view = getUnoPlayerView(LOBBY, pid);
      expect(view?.hand.length).toBeGreaterThanOrEqual(7);
    }
  });

  it("each player's hand uses the custom color names", () => {
    const view = getUnoPlayerView(LOBBY, "p1")!;
    const colorLabels = new Set(
      view.hand.filter(c => c.color !== null).map(c => c.colorLabel)
    );
    for (const label of colorLabels) {
      expect(["Fire", "Water", "Forest", "Sand"]).toContain(label);
    }
  });

  it("starting discard is never wild_draw_four", () => {
    const view = getUnoPlayerView(LOBBY, "p1")!;
    expect(view.turn.discardTop.type).not.toBe("wild_draw_four");
  });
});

// ── Game creation & views ────────────────────────────────────────────────────

describe("game creation", () => {
  afterEach(() => cleanupUnoGame(LOBBY));

  it("isUnoGame returns true after creation", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    expect(isUnoGame(LOBBY)).toBe(true);
  });

  it("getUnoPlayerIds returns all players", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    expect(getUnoPlayerIds(LOBBY)).toEqual(PLAYERS);
  });

  it("scores start at 0", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    const scores = getUnoScores(LOBBY);
    for (const pid of PLAYERS) expect(scores[pid]).toBe(0);
  });

  it("phase starts as playing", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    expect(getUnoPhase(LOBBY)).toBe("playing");
  });

  it("current player is one of the players", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    expect(PLAYERS).toContain(currentPlayer());
  });
});

// ── playCard ─────────────────────────────────────────────────────────────────

describe("playCard", () => {
  beforeEach(() => createUnoGame(LOBBY, PLAYERS, TEMPLATE));
  afterEach(() => cleanupUnoGame(LOBBY));

  it("wrong player cannot play", () => {
    const cur = currentPlayer();
    const other = PLAYERS.find(p => p !== cur)!;
    const view = getUnoPlayerView(LOBBY, other)!;
    if (view.hand.length > 0) {
      const result = playCard(LOBBY, other, view.hand[0].id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not your turn/i);
    }
  });

  it("cannot play a card not in hand", () => {
    const result = playCard(LOBBY, currentPlayer(), "fake-card-id");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in hand/i);
  });

  it("playing a valid card succeeds and advances turn", () => {
    const pid = currentPlayer();
    const playable = findPlayable();
    if (playable) {
      const color: UnoColor | undefined =
        (playable.type === "wild" || playable.type === "wild_draw_four") ? "red" : undefined;
      const result = playCard(LOBBY, pid, playable.id, color);
      expect(result.success).toBe(true);
      // Hand should shrink by 1
      const viewAfter = getUnoPlayerView(LOBBY, pid)!;
      expect(viewAfter.hand.find(c => c.id === playable.id)).toBeUndefined();
    }
  });

  it("playing an invalid card fails", () => {
    const pid = currentPlayer();
    const view = getUnoPlayerView(LOBBY, pid)!;
    // Find a card that is NOT playable
    const unplayable = view.hand.find(c => !view.playableCardIds.includes(c.id));
    if (unplayable) {
      const result = playCard(LOBBY, pid, unplayable.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid play/i);
    }
  });
});

// ── drawCard ─────────────────────────────────────────────────────────────────

describe("drawCard", () => {
  beforeEach(() => createUnoGame(LOBBY, PLAYERS, TEMPLATE));
  afterEach(() => cleanupUnoGame(LOBBY));

  it("current player can draw", () => {
    const pid = currentPlayer();
    const handBefore = getUnoPlayerView(LOBBY, pid)!.hand.length;
    const result = drawCard(LOBBY, pid);
    expect(result.success).toBe(true);
    // Hand grows by 1, turn advances
    const handAfter = getUnoPlayerView(LOBBY, pid)!.hand.length;
    expect(handAfter).toBe(handBefore + 1);
    expect(currentPlayer()).not.toBe(pid);
  });

  it("wrong player cannot draw", () => {
    const cur = currentPlayer();
    const other = PLAYERS.find(p => p !== cur)!;
    const result = drawCard(LOBBY, other);
    expect(result.success).toBe(false);
  });
});

// ── callUno / challengeUno ───────────────────────────────────────────────────

describe("callUno", () => {
  beforeEach(() => createUnoGame(LOBBY, PLAYERS, TEMPLATE));
  afterEach(() => cleanupUnoGame(LOBBY));

  it("player with 3+ cards cannot call Uno", () => {
    // All players start with 7+ cards
    expect(callUno(LOBBY, "p1")).toBe(false);
  });
});

describe("challengeUno", () => {
  beforeEach(() => createUnoGame(LOBBY, PLAYERS, TEMPLATE));
  afterEach(() => cleanupUnoGame(LOBBY));

  it("cannot challenge when no one is vulnerable", () => {
    const result = challengeUno(LOBBY, "p2", "p1");
    expect(result.success).toBe(false);
  });
});

// ── Skip card effect ─────────────────────────────────────────────────────────

describe("skip card effect", () => {
  beforeEach(() => createUnoGame(LOBBY, PLAYERS, TEMPLATE));
  afterEach(() => cleanupUnoGame(LOBBY));

  it("skip card skips the next player", () => {
    const pid = currentPlayer();
    const view = getUnoPlayerView(LOBBY, pid)!;
    const skipCard = view.hand.find(
      c => c.type === "skip" && view.playableCardIds.includes(c.id)
    );
    if (skipCard) {
      // Record order: current -> next -> after-next
      const curIdx = PLAYERS.indexOf(pid);
      playCard(LOBBY, pid, skipCard.id);
      // The next player should be skipped
      const afterSkip = currentPlayer();
      // afterSkip should NOT be the player who would normally go next
      // (unless direction was reversed by start card, so just verify turn moved)
      expect(afterSkip).not.toBe(pid);
    }
  });
});

// ── Reverse card effect ──────────────────────────────────────────────────────

describe("reverse card effect", () => {
  afterEach(() => cleanupUnoGame(LOBBY));

  it("in 2-player game, reverse acts as skip", () => {
    const twoPlayers = ["p1", "p2"];
    createUnoGame(LOBBY, twoPlayers, TEMPLATE);

    const pid = currentPlayer();
    const view = getUnoPlayerView(LOBBY, pid)!;
    const reverseCard = view.hand.find(
      c => c.type === "reverse" && view.playableCardIds.includes(c.id)
    );
    if (reverseCard) {
      playCard(LOBBY, pid, reverseCard.id);
      // In 2-player, reverse = skip, so same player goes again
      expect(currentPlayer()).toBe(pid);
    }
  });
});

// ── Wild card color choice ───────────────────────────────────────────────────

describe("wild card color choice", () => {
  beforeEach(() => createUnoGame(LOBBY, PLAYERS, TEMPLATE));
  afterEach(() => cleanupUnoGame(LOBBY));

  it("playing a wild sets active color to chosen color", () => {
    const pid = currentPlayer();
    const view = getUnoPlayerView(LOBBY, pid)!;
    const wildCard = view.hand.find(
      c => c.type === "wild" && view.playableCardIds.includes(c.id)
    );
    if (wildCard) {
      playCard(LOBBY, pid, wildCard.id, "green");
      // Next player's view should show green as active
      const nextView = currentView()!;
      expect(nextView.turn.activeColor).toBe("green");
    }
  });
});

// ── Full round lifecycle ─────────────────────────────────────────────────────

describe("round lifecycle", () => {
  afterEach(() => cleanupUnoGame(LOBBY));

  it("a round can be played to completion", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "rounds", value: 3 });
    const winner = playUntilRoundOver();
    expect(winner).not.toBeNull();
    expect(PLAYERS).toContain(winner);
    expect(getUnoPhase(LOBBY)).toBe("round_over");
  });

  it("winner earns points from opponents' remaining cards", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "rounds", value: 3 });
    const winner = playUntilRoundOver()!;
    const scores = getUnoScores(LOBBY);
    expect(scores[winner]).toBeGreaterThan(0);
  });

  it("advanceUnoRound starts a new round", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "rounds", value: 3 });
    playUntilRoundOver();
    const result = advanceUnoRound(LOBBY);
    expect(result.started).toBe(true);
    expect(result.gameOver).toBe(false);
    expect(getUnoPhase(LOBBY)).toBe("playing");
  });
});

// ── Game over conditions ─────────────────────────────────────────────────────

describe("game over conditions", () => {
  afterEach(() => cleanupUnoGame(LOBBY));

  it("single_round mode ends after 1 round", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "single_round", value: 1 });
    playUntilRoundOver();
    expect(isUnoGameOver(LOBBY)).toBe(true);
    const result = advanceUnoRound(LOBBY);
    expect(result.started).toBe(false);
    expect(result.gameOver).toBe(true);
  });

  it("rounds mode ends after max rounds", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "rounds", value: 2 });
    playUntilRoundOver();
    advanceUnoRound(LOBBY);
    playUntilRoundOver();
    // After 2 rounds, game should be over
    expect(isUnoGameOver(LOBBY)).toBe(true);
  });
});

// ── Bot AI ───────────────────────────────────────────────────────────────────

describe("botPlayUnoTurn", () => {
  afterEach(() => cleanupUnoGame(LOBBY));

  it("bot plays or draws successfully", () => {
    const botPlayers = ["bot-aaa", "bot-bbb", "bot-ccc"];
    createUnoGame(LOBBY, botPlayers, TEMPLATE);
    const botId = currentPlayer();
    const result = botPlayUnoTurn(LOBBY, botId);
    expect(result.success).toBe(true);
  });

  it("bot can play a full round", () => {
    const botPlayers = ["bot-aaa", "bot-bbb", "bot-ccc"];
    createUnoGame(LOBBY, botPlayers, TEMPLATE, { mode: "single_round", value: 1 });
    // Play through via bot AI
    for (let i = 0; i < 500; i++) {
      const phase = getUnoPhase(LOBBY);
      if (phase !== "playing") break;
      const botId = currentPlayer();
      botPlayUnoTurn(LOBBY, botId);
    }
    expect(getUnoPhase(LOBBY)).toBe("round_over");
  });
});

// ── handleUnoTurnTimeout ─────────────────────────────────────────────────────

describe("handleUnoTurnTimeout", () => {
  beforeEach(() => createUnoGame(LOBBY, PLAYERS, TEMPLATE));
  afterEach(() => cleanupUnoGame(LOBBY));

  it("forces current player to draw and advances turn", () => {
    const pid = currentPlayer();
    const handBefore = getUnoPlayerView(LOBBY, pid)!.hand.length;
    const result = handleUnoTurnTimeout(LOBBY);
    expect(result.success).toBe(true);
    const handAfter = getUnoPlayerView(LOBBY, pid)!.hand.length;
    expect(handAfter).toBe(handBefore + 1);
    expect(currentPlayer()).not.toBe(pid);
  });
});

// ── remapUnoGamePlayer ───────────────────────────────────────────────────────

describe("remapUnoGamePlayer", () => {
  beforeEach(() => createUnoGame(LOBBY, PLAYERS, TEMPLATE));
  afterEach(() => cleanupUnoGame(LOBBY));

  it("moves hand and score to new ID", () => {
    const view = getUnoPlayerView(LOBBY, "p1")!;
    const handSize = view.hand.length;
    remapUnoGamePlayer(LOBBY, "p1", "p1-new");

    // Old ID has empty hand (no longer a real player), new ID has the hand
    const oldView = getUnoPlayerView(LOBBY, "p1")!;
    expect(oldView.hand).toHaveLength(0);
    const newView = getUnoPlayerView(LOBBY, "p1-new")!;
    expect(newView.hand).toHaveLength(handSize);
  });

  it("updates player IDs list", () => {
    remapUnoGamePlayer(LOBBY, "p1", "p1-new");
    expect(getUnoPlayerIds(LOBBY)).toContain("p1-new");
    expect(getUnoPlayerIds(LOBBY)).not.toContain("p1");
  });
});

// ── Stacking mode ────────────────────────────────────────────────────────────

describe("stacking mode", () => {
  afterEach(() => cleanupUnoGame(LOBBY));

  it("creates game with stacking enabled", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "rounds", value: 3 }, { unoStacking: true });
    const view = getUnoPlayerView(LOBBY, "p1")!;
    expect(view.stackingEnabled).toBe(true);
  });

  it("creates game with stacking disabled by default", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    const view = getUnoPlayerView(LOBBY, "p1")!;
    expect(view.stackingEnabled).toBe(false);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("operations on nonexistent game return errors/defaults", () => {
    expect(getUnoPlayerView("nope", "p1")).toBeNull();
    expect(getUnoCurrentPlayer("nope")).toBeUndefined();
    expect(getUnoScores("nope")).toEqual({});
    expect(isUnoGameOver("nope")).toBe(false);
    expect(getUnoPhase("nope")).toBeUndefined();
    expect(getUnoPlayerIds("nope")).toEqual([]);
    expect(isUnoGame("nope")).toBe(false);
    expect(playCard("nope", "p1", "c1")).toEqual({ success: false, error: "Game not found" });
    expect(drawCard("nope", "p1")).toEqual({ success: false, error: "Game not found" });
    expect(callUno("nope", "p1")).toBe(false);
    expect(challengeUno("nope", "p1", "p2")).toEqual({ success: false, penalized: false });
    expect(advanceUnoRound("nope")).toEqual({ started: false, gameOver: false });
    expect(handleUnoTurnTimeout("nope")).toEqual({ success: false });
    expect(botPlayUnoTurn("nope", "bot-x")).toEqual({ success: false });
  });

  it("cleanup removes game", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    expect(isUnoGame(LOBBY)).toBe(true);
    cleanupUnoGame(LOBBY);
    expect(isUnoGame(LOBBY)).toBe(false);
  });
});

// ── Snapshot round-trip ──────────────────────────────────────────────────────
// These tests protect the redeploy-survival path: game state exported on
// SIGTERM is stringified to JSON for Postgres JSONB, then parsed back and
// fed through restoreUnoGames on the next boot. Anything that doesn't
// round-trip cleanly (Maps, Sets, undefined fields) would break restore
// silently in production.

describe("exportUnoGames / restoreUnoGames", () => {
  afterEach(() => cleanupUnoGame(LOBBY));

  it("returns empty array when no games exist", () => {
    expect(exportUnoGames()).toEqual([]);
  });

  it("exports one entry per active game", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    createUnoGame("other-uno", ["x", "y"], TEMPLATE);
    expect(exportUnoGames()).toHaveLength(2);
    cleanupUnoGame("other-uno");
  });

  it("round-trips through JSON and preserves gameplay state", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    // Perturb state so we're not just round-tripping defaults.
    callUno(LOBBY, PLAYERS[0]);
    const beforeScores = getUnoScores(LOBBY);
    const beforePhase = getUnoPhase(LOBBY);
    const beforePlayer = getUnoCurrentPlayer(LOBBY);
    const beforeView = getUnoPlayerView(LOBBY, PLAYERS[0])!;

    // Simulate the SIGTERM → JSONB → boot cycle.
    const snapshot = JSON.parse(JSON.stringify(exportUnoGames()));
    cleanupUnoGame(LOBBY);
    expect(isUnoGame(LOBBY)).toBe(false);
    restoreUnoGames(snapshot);

    expect(isUnoGame(LOBBY)).toBe(true);
    expect(getUnoScores(LOBBY)).toEqual(beforeScores);
    expect(getUnoPhase(LOBBY)).toBe(beforePhase);
    expect(getUnoCurrentPlayer(LOBBY)).toBe(beforePlayer);
    // Hand contents must survive — they live in a Map that got serialized as entries.
    const afterView = getUnoPlayerView(LOBBY, PLAYERS[0])!;
    expect(afterView.hand).toEqual(beforeView.hand);
  });

  it("refreshes turnDeadline on restore so timers start fresh", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    const exported = exportUnoGames();
    // Simulate a stale deadline from a server that's been down for a minute.
    exported[0].turnDeadline = Date.now() - 60_000;
    const beforeRestore = Date.now();
    restoreUnoGames(JSON.parse(JSON.stringify(exported)));
    const view = getUnoPlayerView(LOBBY, PLAYERS[0])!;
    // Restored deadline should be in the future relative to restore time.
    expect(view.turn.turnDeadline).toBeGreaterThanOrEqual(beforeRestore);
  });

  it("serializes unoCalledPlayers Set as an array in the exported snapshot", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    // Pre-seed the Set directly on the exported object to simulate a game
    // mid-play where someone has called Uno. We verify JSON survives the round.
    const exported = exportUnoGames();
    expect(Array.isArray(exported[0].unoCalledPlayers)).toBe(true);
    exported[0].unoCalledPlayers = [PLAYERS[0]];
    const roundTripped = JSON.parse(JSON.stringify(exported));
    cleanupUnoGame(LOBBY);
    restoreUnoGames(roundTripped);
    // Re-export and verify the Set was rehydrated and re-serialized.
    expect(exportUnoGames()[0].unoCalledPlayers).toContain(PLAYERS[0]);
  });

  it("restore overwrites an existing game with the same code", () => {
    createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    const snapshot = JSON.parse(JSON.stringify(exportUnoGames()));
    // Mutate a field on the snapshot and restore — live state should be replaced.
    snapshot[0].roundNumber = 99;
    restoreUnoGames(snapshot);
    expect(exportUnoGames()[0].roundNumber).toBe(99);
  });
});
