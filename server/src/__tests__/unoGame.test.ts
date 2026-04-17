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

async function currentPlayer(): Promise<string> {
  return (await getUnoCurrentPlayer(LOBBY))!;
}

async function currentView(): Promise<ReturnType<typeof getUnoPlayerView> extends Promise<infer T> ? T : never> {
  return (await getUnoPlayerView(LOBBY, await currentPlayer())) as any;
}

async function findPlayable(): Promise<UnoCard | null> {
  const view = (await currentView())!;
  if (view.playableCardIds.length === 0) return null;
  return view.hand.find(c => c.id === view.playableCardIds[0]) || null;
}

async function playUntilRoundOver(limit = 500): Promise<string | null> {
  for (let i = 0; i < limit; i++) {
    const pid = await currentPlayer();
    const view = (await getUnoPlayerView(LOBBY, pid))!;
    if (view.turn.phase !== "playing") return null;

    if (view.playableCardIds.length > 0) {
      const cardToPlay = view.hand.find(c => c.id === view.playableCardIds[0])!;
      const color: UnoColor | undefined =
        (cardToPlay.type === "wild" || cardToPlay.type === "wild_draw_four") ? "red" : undefined;

      if (view.hand.length === 2) await callUno(LOBBY, pid);

      const result = await playCard(LOBBY, pid, cardToPlay.id, color);
      if (result.roundOver) return result.winnerId || null;
    } else {
      await drawCard(LOBBY, pid);
    }
  }
  return null;
}

// ── isValidPlay (sync — pure function) ───────────────────────────────────────

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
  beforeEach(async () => { await createUnoGame(LOBBY, PLAYERS, TEMPLATE); });
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("deals at least 7 cards to each player", async () => {
    for (const pid of PLAYERS) {
      const view = await getUnoPlayerView(LOBBY, pid);
      expect(view?.hand.length).toBeGreaterThanOrEqual(7);
    }
  });

  it("each player's hand uses the custom color names", async () => {
    const view = (await getUnoPlayerView(LOBBY, "p1"))!;
    const colorLabels = new Set(
      view.hand.filter(c => c.color !== null).map(c => c.colorLabel)
    );
    for (const label of colorLabels) {
      expect(["Fire", "Water", "Forest", "Sand"]).toContain(label);
    }
  });

  it("starting discard is never wild_draw_four", async () => {
    const view = (await getUnoPlayerView(LOBBY, "p1"))!;
    expect(view.turn.discardTop.type).not.toBe("wild_draw_four");
  });
});

// ── Game creation & views ────────────────────────────────────────────────────

describe("game creation", () => {
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("isUnoGame returns true after creation", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    expect(await isUnoGame(LOBBY)).toBe(true);
  });

  it("getUnoPlayerIds returns all players", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    expect(await getUnoPlayerIds(LOBBY)).toEqual(PLAYERS);
  });

  it("scores start at 0", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    const scores = await getUnoScores(LOBBY);
    for (const pid of PLAYERS) expect(scores[pid]).toBe(0);
  });

  it("phase starts as playing", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    expect(await getUnoPhase(LOBBY)).toBe("playing");
  });

  it("current player is one of the players", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    expect(PLAYERS).toContain(await currentPlayer());
  });
});

// ── playCard ─────────────────────────────────────────────────────────────────

describe("playCard", () => {
  beforeEach(async () => { await createUnoGame(LOBBY, PLAYERS, TEMPLATE); });
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("wrong player cannot play", async () => {
    const cur = await currentPlayer();
    const other = PLAYERS.find(p => p !== cur)!;
    const view = (await getUnoPlayerView(LOBBY, other))!;
    if (view.hand.length > 0) {
      const result = await playCard(LOBBY, other, view.hand[0].id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not your turn/i);
    }
  });

  it("cannot play a card not in hand", async () => {
    const result = await playCard(LOBBY, await currentPlayer(), "fake-card-id");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in hand/i);
  });

  it("playing a valid card succeeds and advances turn", async () => {
    const pid = await currentPlayer();
    const playable = await findPlayable();
    if (playable) {
      const color: UnoColor | undefined =
        (playable.type === "wild" || playable.type === "wild_draw_four") ? "red" : undefined;
      const result = await playCard(LOBBY, pid, playable.id, color);
      expect(result.success).toBe(true);
      const viewAfter = (await getUnoPlayerView(LOBBY, pid))!;
      expect(viewAfter.hand.find(c => c.id === playable.id)).toBeUndefined();
    }
  });

  it("playing an invalid card fails", async () => {
    const pid = await currentPlayer();
    const view = (await getUnoPlayerView(LOBBY, pid))!;
    const unplayable = view.hand.find(c => !view.playableCardIds.includes(c.id));
    if (unplayable) {
      const result = await playCard(LOBBY, pid, unplayable.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid play/i);
    }
  });
});

// ── drawCard ─────────────────────────────────────────────────────────────────

describe("drawCard", () => {
  beforeEach(async () => { await createUnoGame(LOBBY, PLAYERS, TEMPLATE); });
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("current player can draw", async () => {
    const pid = await currentPlayer();
    const handBefore = (await getUnoPlayerView(LOBBY, pid))!.hand.length;
    const result = await drawCard(LOBBY, pid);
    expect(result.success).toBe(true);
    const handAfter = (await getUnoPlayerView(LOBBY, pid))!.hand.length;
    expect(handAfter).toBe(handBefore + 1);
    expect(await currentPlayer()).not.toBe(pid);
  });

  it("wrong player cannot draw", async () => {
    const cur = await currentPlayer();
    const other = PLAYERS.find(p => p !== cur)!;
    const result = await drawCard(LOBBY, other);
    expect(result.success).toBe(false);
  });
});

// ── callUno / challengeUno ───────────────────────────────────────────────────

describe("callUno", () => {
  beforeEach(async () => { await createUnoGame(LOBBY, PLAYERS, TEMPLATE); });
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("player with 3+ cards cannot call Uno", async () => {
    expect(await callUno(LOBBY, "p1")).toBe(false);
  });
});

describe("challengeUno", () => {
  beforeEach(async () => { await createUnoGame(LOBBY, PLAYERS, TEMPLATE); });
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("cannot challenge when no one is vulnerable", async () => {
    const result = await challengeUno(LOBBY, "p2", "p1");
    expect(result.success).toBe(false);
  });
});

// ── Skip card effect ─────────────────────────────────────────────────────────

describe("skip card effect", () => {
  beforeEach(async () => { await createUnoGame(LOBBY, PLAYERS, TEMPLATE); });
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("skip card skips the next player", async () => {
    const pid = await currentPlayer();
    const view = (await getUnoPlayerView(LOBBY, pid))!;
    const skipCard = view.hand.find(
      c => c.type === "skip" && view.playableCardIds.includes(c.id)
    );
    if (skipCard) {
      await playCard(LOBBY, pid, skipCard.id);
      const afterSkip = await currentPlayer();
      expect(afterSkip).not.toBe(pid);
    }
  });
});

// ── Reverse card effect ──────────────────────────────────────────────────────

describe("reverse card effect", () => {
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("in 2-player game, reverse acts as skip", async () => {
    const twoPlayers = ["p1", "p2"];
    await createUnoGame(LOBBY, twoPlayers, TEMPLATE);

    const pid = await currentPlayer();
    const view = (await getUnoPlayerView(LOBBY, pid))!;
    const reverseCard = view.hand.find(
      c => c.type === "reverse" && view.playableCardIds.includes(c.id)
    );
    if (reverseCard) {
      await playCard(LOBBY, pid, reverseCard.id);
      expect(await currentPlayer()).toBe(pid);
    }
  });
});

// ── Wild card color choice ───────────────────────────────────────────────────

describe("wild card color choice", () => {
  beforeEach(async () => { await createUnoGame(LOBBY, PLAYERS, TEMPLATE); });
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("playing a wild sets active color to chosen color", async () => {
    const pid = await currentPlayer();
    const view = (await getUnoPlayerView(LOBBY, pid))!;
    const wildCard = view.hand.find(
      c => c.type === "wild" && view.playableCardIds.includes(c.id)
    );
    if (wildCard) {
      await playCard(LOBBY, pid, wildCard.id, "green");
      const nextView = (await currentView())!;
      expect(nextView.turn.activeColor).toBe("green");
    }
  });
});

// ── Full round lifecycle ─────────────────────────────────────────────────────

describe("round lifecycle", () => {
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("a round can be played to completion", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "rounds", value: 3 });
    const winner = await playUntilRoundOver();
    expect(winner).not.toBeNull();
    expect(PLAYERS).toContain(winner);
    expect(await getUnoPhase(LOBBY)).toBe("round_over");
  });

  it("winner earns points from opponents' remaining cards", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "rounds", value: 3 });
    const winner = (await playUntilRoundOver())!;
    const scores = await getUnoScores(LOBBY);
    expect(scores[winner]).toBeGreaterThan(0);
  });

  it("advanceUnoRound starts a new round", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "rounds", value: 3 });
    await playUntilRoundOver();
    const result = await advanceUnoRound(LOBBY);
    expect(result.started).toBe(true);
    expect(result.gameOver).toBe(false);
    expect(await getUnoPhase(LOBBY)).toBe("playing");
  });
});

// ── Game over conditions ─────────────────────────────────────────────────────

describe("game over conditions", () => {
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("single_round mode ends after 1 round", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "single_round", value: 1 });
    await playUntilRoundOver();
    expect(await isUnoGameOver(LOBBY)).toBe(true);
    const result = await advanceUnoRound(LOBBY);
    expect(result.started).toBe(false);
    expect(result.gameOver).toBe(true);
  });

  it("rounds mode ends after max rounds", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "rounds", value: 2 });
    await playUntilRoundOver();
    await advanceUnoRound(LOBBY);
    await playUntilRoundOver();
    expect(await isUnoGameOver(LOBBY)).toBe(true);
  });
});

// ── Bot AI ───────────────────────────────────────────────────────────────────

describe("botPlayUnoTurn", () => {
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("bot plays or draws successfully", async () => {
    const botPlayers = ["bot-aaa", "bot-bbb", "bot-ccc"];
    await createUnoGame(LOBBY, botPlayers, TEMPLATE);
    const botId = await currentPlayer();
    const result = await botPlayUnoTurn(LOBBY, botId);
    expect(result.success).toBe(true);
  });

  it("bot can play a full round", async () => {
    const botPlayers = ["bot-aaa", "bot-bbb", "bot-ccc"];
    await createUnoGame(LOBBY, botPlayers, TEMPLATE, { mode: "single_round", value: 1 });
    for (let i = 0; i < 500; i++) {
      const phase = await getUnoPhase(LOBBY);
      if (phase !== "playing") break;
      const botId = await currentPlayer();
      await botPlayUnoTurn(LOBBY, botId);
    }
    expect(await getUnoPhase(LOBBY)).toBe("round_over");
  });
});

// ── handleUnoTurnTimeout ─────────────────────────────────────────────────────

describe("handleUnoTurnTimeout", () => {
  beforeEach(async () => { await createUnoGame(LOBBY, PLAYERS, TEMPLATE); });
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("forces current player to draw and advances turn", async () => {
    const pid = await currentPlayer();
    const handBefore = (await getUnoPlayerView(LOBBY, pid))!.hand.length;
    const result = await handleUnoTurnTimeout(LOBBY);
    expect(result.success).toBe(true);
    const handAfter = (await getUnoPlayerView(LOBBY, pid))!.hand.length;
    expect(handAfter).toBe(handBefore + 1);
    expect(await currentPlayer()).not.toBe(pid);
  });
});

// ── remapUnoGamePlayer ───────────────────────────────────────────────────────

describe("remapUnoGamePlayer", () => {
  beforeEach(async () => { await createUnoGame(LOBBY, PLAYERS, TEMPLATE); });
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("moves hand and score to new ID", async () => {
    const view = (await getUnoPlayerView(LOBBY, "p1"))!;
    const handSize = view.hand.length;
    await remapUnoGamePlayer(LOBBY, "p1", "p1-new");

    const oldView = (await getUnoPlayerView(LOBBY, "p1"))!;
    expect(oldView.hand).toHaveLength(0);
    const newView = (await getUnoPlayerView(LOBBY, "p1-new"))!;
    expect(newView.hand).toHaveLength(handSize);
  });

  it("updates player IDs list", async () => {
    await remapUnoGamePlayer(LOBBY, "p1", "p1-new");
    expect(await getUnoPlayerIds(LOBBY)).toContain("p1-new");
    expect(await getUnoPlayerIds(LOBBY)).not.toContain("p1");
  });
});

// ── Stacking mode ────────────────────────────────────────────────────────────

describe("stacking mode", () => {
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("creates game with stacking enabled", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE, { mode: "rounds", value: 3 }, { unoStacking: true });
    const view = (await getUnoPlayerView(LOBBY, "p1"))!;
    expect(view.stackingEnabled).toBe(true);
  });

  it("creates game with stacking disabled by default", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    const view = (await getUnoPlayerView(LOBBY, "p1"))!;
    expect(view.stackingEnabled).toBe(false);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("operations on nonexistent game return errors/defaults", async () => {
    expect(await getUnoPlayerView("nope", "p1")).toBeNull();
    expect(await getUnoCurrentPlayer("nope")).toBeUndefined();
    expect(await getUnoScores("nope")).toEqual({});
    expect(await isUnoGameOver("nope")).toBe(false);
    expect(await getUnoPhase("nope")).toBeUndefined();
    expect(await getUnoPlayerIds("nope")).toEqual([]);
    expect(await isUnoGame("nope")).toBe(false);
    expect(await playCard("nope", "p1", "c1")).toEqual({ success: false, error: "Game not found" });
    expect(await drawCard("nope", "p1")).toEqual({ success: false, error: "Game not found" });
    expect(await callUno("nope", "p1")).toBe(false);
    expect(await challengeUno("nope", "p1", "p2")).toEqual({ success: false, penalized: false });
    expect(await advanceUnoRound("nope")).toEqual({ started: false, gameOver: false });
    expect(await handleUnoTurnTimeout("nope")).toEqual({ success: false });
    expect(await botPlayUnoTurn("nope", "bot-x")).toEqual({ success: false });
  });

  it("cleanup removes game", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    expect(await isUnoGame(LOBBY)).toBe(true);
    await cleanupUnoGame(LOBBY);
    expect(await isUnoGame(LOBBY)).toBe(false);
  });
});

// ── Snapshot round-trip ──────────────────────────────────────────────────────

describe("exportUnoGames / restoreUnoGames", () => {
  afterEach(async () => { await cleanupUnoGame(LOBBY); });

  it("returns empty array when no games exist", async () => {
    expect(await exportUnoGames()).toEqual([]);
  });

  it("exports one entry per active game", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    await createUnoGame("other-uno", ["x", "y"], TEMPLATE);
    expect(await exportUnoGames()).toHaveLength(2);
    await cleanupUnoGame("other-uno");
  });

  it("round-trips through JSON and preserves gameplay state", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    await callUno(LOBBY, PLAYERS[0]);
    const beforeScores = await getUnoScores(LOBBY);
    const beforePhase = await getUnoPhase(LOBBY);
    const beforePlayer = await getUnoCurrentPlayer(LOBBY);
    const beforeView = (await getUnoPlayerView(LOBBY, PLAYERS[0]))!;

    const snapshot = JSON.parse(JSON.stringify(await exportUnoGames()));
    await cleanupUnoGame(LOBBY);
    expect(await isUnoGame(LOBBY)).toBe(false);
    await restoreUnoGames(snapshot);

    expect(await isUnoGame(LOBBY)).toBe(true);
    expect(await getUnoScores(LOBBY)).toEqual(beforeScores);
    expect(await getUnoPhase(LOBBY)).toBe(beforePhase);
    expect(await getUnoCurrentPlayer(LOBBY)).toBe(beforePlayer);
    const afterView = (await getUnoPlayerView(LOBBY, PLAYERS[0]))!;
    expect(afterView.hand).toEqual(beforeView.hand);
  });

  it("refreshes turnDeadline on restore so timers start fresh", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    const exported = await exportUnoGames();
    exported[0].turnDeadline = Date.now() - 60_000;
    const beforeRestore = Date.now();
    await restoreUnoGames(JSON.parse(JSON.stringify(exported)));
    const view = (await getUnoPlayerView(LOBBY, PLAYERS[0]))!;
    expect(view.turn.turnDeadline).toBeGreaterThanOrEqual(beforeRestore);
  });

  it("serializes unoCalledPlayers Set as an array in the exported snapshot", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    const exported = await exportUnoGames();
    expect(Array.isArray(exported[0].unoCalledPlayers)).toBe(true);
    exported[0].unoCalledPlayers = [PLAYERS[0]];
    const roundTripped = JSON.parse(JSON.stringify(exported));
    await cleanupUnoGame(LOBBY);
    await restoreUnoGames(roundTripped);
    expect((await exportUnoGames())[0].unoCalledPlayers).toContain(PLAYERS[0]);
  });

  it("restore overwrites an existing game with the same code", async () => {
    await createUnoGame(LOBBY, PLAYERS, TEMPLATE);
    const snapshot = JSON.parse(JSON.stringify(await exportUnoGames()));
    snapshot[0].roundNumber = 99;
    await restoreUnoGames(snapshot);
    expect((await exportUnoGames())[0].roundNumber).toBe(99);
  });
});
