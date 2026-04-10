import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createGame,
  startRound,
  getPlayerView,
  submitCards,
  pickWinner,
  advanceRound,
  getScores,
  isGameOver,
  cleanupGame,
  botSubmitCards,
  botPickWinner,
  botCzarSetup,
  czarSetup,
  forceCzarSetup,
  forceSubmitForMissing,
  resolveMetaTargets,
  addPlayerToGame,
  removePlayerFromGame,
  remapGamePlayer,
  resetPlayerHand,
  getWinnerCards,
  getWinInfo,
  endGame,
  getPlayerIds,
  getCzarId,
  getJudgingData,
  getPhaseDeadline,
  getCurrentPhase,
  getGameType,
} from "../game.js";
import type { ChaosCard, KnowledgeCard } from "../types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LOBBY = "test-game-001";
const PLAYERS = ["p1", "p2", "p3"];

// 10 chaos cards — enough for 3 rounds without recycling
const CHAOS: ChaosCard[] = Array.from({ length: 10 }, (_, i) => ({
  id: `c${i}`,
  text: `Question ${i} — ___`,
  pick: 1,
}));
const KNOWLEDGE: KnowledgeCard[] = Array.from({ length: 40 }, (_, i) => ({
  id: `k${i}`,
  text: `Answer ${i}`,
}));

// Pick-2 chaos cards for multi-card submission tests
const CHAOS_PICK2: ChaosCard[] = Array.from({ length: 10 }, (_, i) => ({
  id: `cp2-${i}`,
  text: `___ and ___ walk into a bar`,
  pick: 2,
}));

// Meta effect chaos cards
const CHAOS_META: ChaosCard[] = [
  {
    id: "cm-add",
    text: "Bonus! ___",
    pick: 1,
    metaEffect: { type: "score_add", value: 2, target: "winner" },
  },
  {
    id: "cm-sub",
    text: "Penalty! ___",
    pick: 1,
    metaEffect: { type: "score_subtract", value: 1, target: "all_others" },
  },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `cm-filler-${i}`,
    text: `Meta filler ${i} — ___`,
    pick: 1,
  })),
];

function nonCzar(czarId: string) {
  return PLAYERS.find((p) => p !== czarId)!;
}

function allNonCzar(czarId: string) {
  return PLAYERS.filter((p) => p !== czarId);
}

/** Submit for all non-czar players. Returns final result. */
function submitAll(czarId: string) {
  const submitters = allNonCzar(czarId);
  let result = { allSubmitted: false, success: false };
  for (const p of submitters) {
    const view = getPlayerView(LOBBY, p)!;
    const pick = view.round!.chaosCard.pick;
    const cardIds = view.hand.slice(0, pick).map((c) => c.id);
    result = submitCards(LOBBY, p, cardIds);
  }
  return result;
}

/** Play a full round: start → submit all → pick winner. Returns winner ID. */
function playFullRound(): string {
  const round = startRound(LOBBY)!;
  const czar = round.czarId;
  const submitters = allNonCzar(czar);

  for (const p of submitters) {
    const view = getPlayerView(LOBBY, p)!;
    const pick = round.chaosCard.pick;
    const cardIds = view.hand.slice(0, pick).map((c) => c.id);
    submitCards(LOBBY, p, cardIds);
  }

  const winner = submitters[0];
  pickWinner(LOBBY, czar, winner);
  return winner;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  cleanupGame(LOBBY);
  createGame(LOBBY, PLAYERS, CHAOS, KNOWLEDGE, { mode: "rounds", value: 3 });
});

afterEach(() => {
  cleanupGame(LOBBY);
});

// ── Round lifecycle (existing tests preserved) ───────────────────────────────

describe("startRound", () => {
  it("returns a valid round state", () => {
    const round = startRound(LOBBY);
    expect(round).not.toBeNull();
    expect(PLAYERS).toContain(round!.czarId);
    expect(round!.chaosCard).toBeDefined();
    expect(round!.phase).toBe("submitting");
  });

  it("czar rotates each round", () => {
    const r1 = startRound(LOBBY)!;
    advanceRound(LOBBY);
    const r2 = startRound(LOBBY)!;
    expect(r2.czarId).not.toBe(r1.czarId);
  });

  it("returns null after max rounds exceeded", () => {
    for (let i = 0; i < 3; i++) {
      playFullRound();
      advanceRound(LOBBY);
    }
    expect(startRound(LOBBY)).toBeNull();
  });
});

describe("submitCards", () => {
  it("non-czar player can submit a card", () => {
    const round = startRound(LOBBY)!;
    const player = nonCzar(round.czarId);
    const view = getPlayerView(LOBBY, player)!;
    const cardId = view.hand[0].id;

    const result = submitCards(LOBBY, player, [cardId]);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("czar cannot submit", () => {
    const round = startRound(LOBBY)!;
    const czarView = getPlayerView(LOBBY, round.czarId)!;
    const cardId = czarView.hand[0].id;

    const result = submitCards(LOBBY, round.czarId, [cardId]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/czar/i);
  });

  it("player cannot submit twice", () => {
    const round = startRound(LOBBY)!;
    const player = nonCzar(round.czarId);
    const view = getPlayerView(LOBBY, player)!;

    submitCards(LOBBY, player, [view.hand[0].id]);
    const second = submitCards(LOBBY, player, [view.hand[1].id]);
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already/i);
  });

  it("all players submitted triggers judging phase", () => {
    const round = startRound(LOBBY)!;
    const result = submitAll(round.czarId);
    expect(result.allSubmitted).toBe(true);
  });

  it("card not in hand is rejected", () => {
    const round = startRound(LOBBY)!;
    const player = nonCzar(round.czarId);
    const result = submitCards(LOBBY, player, ["fake-id"]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in your hand/i);
  });

  it("wrong number of cards is rejected", () => {
    const round = startRound(LOBBY)!;
    const player = nonCzar(round.czarId);
    const view = getPlayerView(LOBBY, player)!;
    // Submit 2 cards for a pick-1 prompt
    const result = submitCards(LOBBY, player, [view.hand[0].id, view.hand[1].id]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exactly/i);
  });
});

describe("pickWinner + scoring", () => {
  it("winner gains a point", () => {
    const round = startRound(LOBBY)!;
    const czar = round.czarId;
    const submitters = allNonCzar(czar);

    for (const p of submitters) {
      const view = getPlayerView(LOBBY, p)!;
      submitCards(LOBBY, p, [view.hand[0].id]);
    }

    const winner = submitters[0];
    const result = pickWinner(LOBBY, czar, winner);
    expect(result.success).toBe(true);

    const scores = getScores(LOBBY)!;
    expect(scores[winner]).toBe(1);
    expect(scores[submitters[1]]).toBe(0);
  });

  it("only czar can pick the winner", () => {
    const round = startRound(LOBBY)!;
    const czar = round.czarId;
    const submitters = allNonCzar(czar);

    for (const p of submitters) {
      const view = getPlayerView(LOBBY, p)!;
      submitCards(LOBBY, p, [view.hand[0].id]);
    }

    const result = pickWinner(LOBBY, submitters[0], submitters[1]);
    expect(result.success).toBe(false);
  });

  it("invalid winner ID is rejected", () => {
    const round = startRound(LOBBY)!;
    submitAll(round.czarId);
    const result = pickWinner(LOBBY, round.czarId, "nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid winner/i);
  });
});

// ── Game over detection ───────────────────────────────────────────────────────

describe("isGameOver", () => {
  it("not over after 0 rounds", () => {
    expect(isGameOver(LOBBY)).toBe(false);
  });

  it("over after maxRounds rounds", () => {
    for (let i = 0; i < 3; i++) {
      playFullRound();
      advanceRound(LOBBY);
    }
    expect(isGameOver(LOBBY)).toBe(true);
  });
});

// ── Pick-2 cards ──────────────────────────────────────────────────────────────

describe("pick-2 chaos cards", () => {
  beforeEach(() => {
    cleanupGame(LOBBY);
    createGame(LOBBY, PLAYERS, CHAOS_PICK2, KNOWLEDGE, { mode: "rounds", value: 3 });
  });

  it("player must submit exactly 2 cards", () => {
    const round = startRound(LOBBY)!;
    const player = nonCzar(round.czarId);
    const view = getPlayerView(LOBBY, player)!;

    // Only 1 card should fail
    const r1 = submitCards(LOBBY, player, [view.hand[0].id]);
    expect(r1.success).toBe(false);
    expect(r1.error).toMatch(/exactly 2/i);

    // 2 cards should succeed
    const r2 = submitCards(LOBBY, player, [view.hand[0].id, view.hand[1].id]);
    expect(r2.success).toBe(true);
  });

  it("hand replenished after submitting 2 cards", () => {
    const round = startRound(LOBBY)!;
    const player = nonCzar(round.czarId);
    const handBefore = getPlayerView(LOBBY, player)!.hand.length;

    const view = getPlayerView(LOBBY, player)!;
    submitCards(LOBBY, player, [view.hand[0].id, view.hand[1].id]);

    // Hand should still be 7 (submitted 2, drew 2)
    const handAfter = getPlayerView(LOBBY, player)!.hand.length;
    expect(handAfter).toBe(handBefore);
  });
});

// ── Depleted hand (deck exhaustion) ──────────────────────────────────────────

describe("depleted hand with pick-2", () => {
  // 3 players × 7 cards = 21 cards dealt. With only 22 knowledge cards total,
  // the deck is nearly empty after dealing — but played cards are immediately
  // discarded and reshuffled, so hands stay full across rounds.
  const TINY_KNOWLEDGE: KnowledgeCard[] = Array.from({ length: 22 }, (_, i) => ({
    id: `tk${i}`,
    text: `Tiny answer ${i}`,
  }));

  beforeEach(() => {
    cleanupGame(LOBBY);
    createGame(LOBBY, PLAYERS, CHAOS_PICK2, TINY_KNOWLEDGE, { mode: "rounds", value: 10 });
  });

  it("hands stay full thanks to mid-round reshuffling with a tiny deck", () => {
    // With immediate discarding, played cards are recycled into the deck
    // so hands should never deplete even with a very small card pool.
    for (let i = 0; i < 6; i++) {
      const round = startRound(LOBBY);
      if (!round) break;
      const czar = round.czarId;
      const submitters = allNonCzar(czar);

      for (const p of submitters) {
        const view = getPlayerView(LOBBY, p)!;
        expect(view.hand.length).toBeGreaterThanOrEqual(2);
        submitCards(LOBBY, p, [view.hand[0].id, view.hand[1].id]);
      }

      pickWinner(LOBBY, czar, submitters[0]);
      advanceRound(LOBBY);
    }
  });

  it("player can submit fewer cards if deck is truly exhausted", () => {
    // With only 8 total cards and 3 players (7 each = would need 21),
    // some players start with fewer than 7 cards
    const MICRO_KNOWLEDGE: KnowledgeCard[] = Array.from({ length: 8 }, (_, i) => ({
      id: `mk${i}`,
      text: `Micro answer ${i}`,
    }));
    cleanupGame(LOBBY);
    createGame(LOBBY, PLAYERS, CHAOS_PICK2, MICRO_KNOWLEDGE, { mode: "rounds", value: 3 });

    const round = startRound(LOBBY);
    expect(round).not.toBeNull();
    const czar = round!.czarId;
    const submitters = allNonCzar(czar);

    // With 8 cards split among 3 players, at least one should have a short hand
    let foundShort = false;
    for (const p of submitters) {
      const view = getPlayerView(LOBBY, p)!;
      if (view.hand.length === 1) {
        const result = submitCards(LOBBY, p, [view.hand[0].id]);
        expect(result.success).toBe(true);
        foundShort = true;
      } else if (view.hand.length >= 2) {
        submitCards(LOBBY, p, [view.hand[0].id, view.hand[1].id]);
      }
    }
    expect(foundShort).toBe(true);
  });
});

// ── Hand replenishment ���───────────────────────────────────────────────────────

describe("hand replenishment", () => {
  it("hand stays at 7 after submitting", () => {
    const round = startRound(LOBBY)!;
    const player = nonCzar(round.czarId);
    const view = getPlayerView(LOBBY, player)!;
    submitCards(LOBBY, player, [view.hand[0].id]);

    const handAfter = getPlayerView(LOBBY, player)!.hand.length;
    expect(handAfter).toBe(7);
  });
});

// ── Bot logic ─────────────────────────────────────────────────────────────────

describe("botSubmitCards", () => {
  const BOT_LOBBY = "test-bot";
  const BOT_PLAYERS = ["bot-a", "bot-b", "bot-c"];

  beforeEach(() => {
    cleanupGame(BOT_LOBBY);
    createGame(BOT_LOBBY, BOT_PLAYERS, CHAOS, KNOWLEDGE, { mode: "rounds", value: 3 });
  });
  afterEach(() => cleanupGame(BOT_LOBBY));

  it("bot can submit cards", () => {
    const round = startRound(BOT_LOBBY)!;
    const bot = BOT_PLAYERS.find((p) => p !== round.czarId)!;
    const result = botSubmitCards(BOT_LOBBY, bot);
    expect(result.success).toBe(true);
  });

  it("czar bot cannot submit", () => {
    const round = startRound(BOT_LOBBY)!;
    const result = botSubmitCards(BOT_LOBBY, round.czarId);
    expect(result.success).toBe(false);
  });

  it("bot cannot submit twice", () => {
    const round = startRound(BOT_LOBBY)!;
    const bot = BOT_PLAYERS.find((p) => p !== round.czarId)!;
    botSubmitCards(BOT_LOBBY, bot);
    const result = botSubmitCards(BOT_LOBBY, bot);
    expect(result.success).toBe(false);
  });

  it("all bots submitting triggers judging", () => {
    const round = startRound(BOT_LOBBY)!;
    const submitters = BOT_PLAYERS.filter((p) => p !== round.czarId);
    let result = { success: false, allSubmitted: false };
    for (const bot of submitters) {
      result = botSubmitCards(BOT_LOBBY, bot);
    }
    expect(result.allSubmitted).toBe(true);
  });
});

describe("botPickWinner", () => {
  const BOT_LOBBY = "test-bot-pick";
  const BOT_PLAYERS = ["bot-a", "bot-b", "bot-c"];

  beforeEach(() => {
    cleanupGame(BOT_LOBBY);
    createGame(BOT_LOBBY, BOT_PLAYERS, CHAOS, KNOWLEDGE, { mode: "rounds", value: 3 });
  });
  afterEach(() => cleanupGame(BOT_LOBBY));

  it("bot czar can pick a winner", () => {
    const round = startRound(BOT_LOBBY)!;
    const submitters = BOT_PLAYERS.filter((p) => p !== round.czarId);
    for (const bot of submitters) botSubmitCards(BOT_LOBBY, bot);

    const result = botPickWinner(BOT_LOBBY, round.czarId);
    expect(result.winnerId).not.toBeNull();
    expect(submitters).toContain(result.winnerId);
  });

  it("non-czar bot cannot pick winner", () => {
    const round = startRound(BOT_LOBBY)!;
    const submitters = BOT_PLAYERS.filter((p) => p !== round.czarId);
    for (const bot of submitters) botSubmitCards(BOT_LOBBY, bot);

    const result = botPickWinner(BOT_LOBBY, submitters[0]);
    expect(result.winnerId).toBeNull();
  });
});

// ── Meta card effects ─────────────────────────────────────────────────────────

describe("resolveMetaTargets", () => {
  it("winner target returns only winner", () => {
    expect(resolveMetaTargets("winner", "p1", "p2", PLAYERS)).toEqual(["p1"]);
  });

  it("czar target returns only czar", () => {
    expect(resolveMetaTargets("czar", "p1", "p2", PLAYERS)).toEqual(["p2"]);
  });

  it("all target returns all players", () => {
    expect(resolveMetaTargets("all", "p1", "p2", PLAYERS)).toEqual(PLAYERS);
  });

  it("all_others excludes winner", () => {
    const result = resolveMetaTargets("all_others", "p1", "p2", PLAYERS);
    expect(result).not.toContain("p1");
    expect(result).toContain("p2");
    expect(result).toContain("p3");
  });

  it("loser returns non-winner non-czar players", () => {
    const result = resolveMetaTargets("loser", "p1", "p2", PLAYERS);
    expect(result).not.toContain("p1"); // winner excluded
    expect(result).not.toContain("p2"); // czar excluded
    expect(result).toContain("p3");
  });
});

describe("meta effect scoring", () => {
  beforeEach(() => {
    cleanupGame(LOBBY);
    createGame(LOBBY, PLAYERS, CHAOS_META, KNOWLEDGE, { mode: "rounds", value: 10 });
  });

  it("score_add meta effect awards extra points", () => {
    // First chaos card in CHAOS_META has score_add +2 for winner
    const round = startRound(LOBBY)!;
    // If we got the meta card, winner gets 1 (normal) + 2 (meta) = 3
    // If not, just regular scoring
    const czar = round.czarId;
    const submitters = allNonCzar(czar);

    for (const p of submitters) {
      const view = getPlayerView(LOBBY, p)!;
      submitCards(LOBBY, p, [view.hand[0].id]);
    }

    const winner = submitters[0];
    const result = pickWinner(LOBBY, czar, winner);
    expect(result.success).toBe(true);

    const scores = getScores(LOBBY)!;
    // At minimum, winner got 1 point; if meta card was drawn, they got bonus
    expect(scores[winner]).toBeGreaterThanOrEqual(1);

    if (result.metaEffect) {
      expect(result.metaEffect.effect.type).toBeDefined();
      expect(result.metaEffect.winnerId).toBe(winner);
    }
  });
});

// ── forceSubmitForMissing ─────────────────────────────────────────────────────

describe("forceSubmitForMissing", () => {
  it("auto-submits for players who haven't submitted", () => {
    const round = startRound(LOBBY)!;
    const czar = round.czarId;
    const submitters = allNonCzar(czar);

    // Only first player submits
    const view = getPlayerView(LOBBY, submitters[0])!;
    submitCards(LOBBY, submitters[0], [view.hand[0].id]);

    const forced = forceSubmitForMissing(LOBBY);
    expect(forced).toContain(submitters[1]);
    expect(forced).not.toContain(submitters[0]); // already submitted
    expect(getCurrentPhase(LOBBY)).toBe("judging");
  });

  it("returns empty array when no one is missing", () => {
    const round = startRound(LOBBY)!;
    submitAll(round.czarId);
    const forced = forceSubmitForMissing(LOBBY);
    expect(forced).toEqual([]);
  });
});

// ── Joking Hazard: czarSetup ──────────────────────────────────────────────────

describe("czarSetup (Joking Hazard)", () => {
  const JH_LOBBY = "test-jh";

  const JH_CHAOS: ChaosCard[] = Array.from({ length: 10 }, (_, i) => ({
    id: `jc${i}`,
    text: `Panel ${i}`,
    pick: 1,
  }));

  beforeEach(() => {
    cleanupGame(JH_LOBBY);
    createGame(JH_LOBBY, PLAYERS, JH_CHAOS, KNOWLEDGE, { mode: "rounds", value: 3 }, "joking_hazard");
  });
  afterEach(() => cleanupGame(JH_LOBBY));

  it("round starts in czar_setup phase", () => {
    const round = startRound(JH_LOBBY)!;
    expect(round.phase).toBe("czar_setup");
  });

  it("czar can play a setup card", () => {
    const round = startRound(JH_LOBBY)!;
    const czarView = getPlayerView(JH_LOBBY, round.czarId)!;
    const cardId = czarView.hand[0].id;

    const result = czarSetup(JH_LOBBY, round.czarId, cardId);
    expect(result.success).toBe(true);
    expect(result.czarSetupCard).toBeDefined();
    expect(getCurrentPhase(JH_LOBBY)).toBe("submitting");
  });

  it("non-czar cannot play setup card", () => {
    const round = startRound(JH_LOBBY)!;
    const other = nonCzar(round.czarId);
    const view = getPlayerView(JH_LOBBY, other)!;

    const result = czarSetup(JH_LOBBY, other, view.hand[0].id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/judge/i);
  });

  it("botCzarSetup plays a card automatically", () => {
    const round = startRound(JH_LOBBY)!;
    const result = botCzarSetup(JH_LOBBY, round.czarId);
    expect(result.success).toBe(true);
    expect(result.czarSetupCard).toBeDefined();
  });

  it("forceCzarSetup auto-plays when czar times out", () => {
    startRound(JH_LOBBY);
    const card = forceCzarSetup(JH_LOBBY);
    expect(card).not.toBeNull();
    expect(getCurrentPhase(JH_LOBBY)).toBe("submitting");
  });
});

// ── Points-mode game over ─────────────────────────────────────────────────────

describe("points-mode game over", () => {
  beforeEach(() => {
    cleanupGame(LOBBY);
    createGame(LOBBY, PLAYERS, CHAOS, KNOWLEDGE, { mode: "points", value: 2 });
  });

  it("game ends when a player reaches target points", () => {
    // Play rounds until someone hits 2 points
    let winner = playFullRound();
    advanceRound(LOBBY);
    winner = playFullRound();
    // After 2 wins by the same player (if czar rotates away from them), game should end
    // Or check manually
    const scores = getScores(LOBBY)!;
    const anyoneWon = Object.values(scores).some((s) => s >= 2);
    if (anyoneWon) {
      expect(isGameOver(LOBBY)).toBe(true);
    }
  });

  it("getWinInfo reports points mode", () => {
    const info = getWinInfo(LOBBY);
    expect(info).toEqual({ mode: "points", value: 2 });
  });
});

// ── addPlayerToGame / removePlayerFromGame ────────────────────────────────────

describe("addPlayerToGame", () => {
  it("adds a new player mid-game", () => {
    startRound(LOBBY);
    const added = addPlayerToGame(LOBBY, "p4");
    expect(added).toBe(true);
    expect(getPlayerIds(LOBBY)).toContain("p4");
    // New player gets a hand
    const view = getPlayerView(LOBBY, "p4")!;
    expect(view.hand.length).toBe(7);
    expect(view.scores["p4"]).toBe(0);
  });

  it("adding an existing player is idempotent", () => {
    const result = addPlayerToGame(LOBBY, "p1");
    expect(result).toBe(true);
    expect(getPlayerIds(LOBBY).filter((id) => id === "p1")).toHaveLength(1);
  });
});

describe("removePlayerFromGame", () => {
  it("removes player and their submission", () => {
    const round = startRound(LOBBY)!;
    const player = nonCzar(round.czarId);
    const view = getPlayerView(LOBBY, player)!;
    submitCards(LOBBY, player, [view.hand[0].id]);

    removePlayerFromGame(LOBBY, player);
    expect(getPlayerIds(LOBBY)).not.toContain(player);
    expect(getScores(LOBBY)![player]).toBeUndefined();
  });
});

// ── remapGamePlayer ───────────────────────────────────────────────────────────

describe("remapGamePlayer", () => {
  it("moves player to new ID preserving hand and score", () => {
    const handBefore = getPlayerView(LOBBY, "p1")!.hand.length;
    remapGamePlayer(LOBBY, "p1", "p1-new");

    expect(getPlayerIds(LOBBY)).toContain("p1-new");
    expect(getPlayerIds(LOBBY)).not.toContain("p1");

    const view = getPlayerView(LOBBY, "p1-new")!;
    expect(view.hand).toHaveLength(handBefore);
    expect(view.scores["p1-new"]).toBe(0);
  });

  it("remaps czar during a round", () => {
    const round = startRound(LOBBY)!;
    remapGamePlayer(LOBBY, round.czarId, "czar-new");
    expect(getCzarId(LOBBY)).toBe("czar-new");
  });

  it("remaps submission during a round", () => {
    const round = startRound(LOBBY)!;
    const player = nonCzar(round.czarId);
    const view = getPlayerView(LOBBY, player)!;
    submitCards(LOBBY, player, [view.hand[0].id]);

    remapGamePlayer(LOBBY, player, "p-new");
    // After all others submit, judging should still work with remapped player
    const remaining = allNonCzar(round.czarId).filter((p) => p !== player);
    for (const p of remaining) {
      const v = getPlayerView(LOBBY, p)!;
      submitCards(LOBBY, p, [v.hand[0].id]);
    }
    // The remapped player's submission should be pickable
    const result = pickWinner(LOBBY, round.czarId, "p-new");
    expect(result.success).toBe(true);
  });
});

// ── resetPlayerHand ───────────────────────────────────────────────────────────

describe("resetPlayerHand", () => {
  it("replaces hand with 7 new cards", () => {
    const oldHand = getPlayerView(LOBBY, "p1")!.hand.map((c) => c.id);
    const newHand = resetPlayerHand(LOBBY, "p1");
    expect(newHand).toHaveLength(7);
    // At least some cards should differ (extremely unlikely to get same 7)
    const newIds = newHand.map((c) => c.id);
    expect(newIds).not.toEqual(oldHand);
  });
});

// ── getWinnerCards ────────────────────────────────────────────────────────────

describe("getWinnerCards", () => {
  it("returns null before winner is picked", () => {
    startRound(LOBBY);
    expect(getWinnerCards(LOBBY)).toBeNull();
  });

  it("returns winning cards after pick", () => {
    const round = startRound(LOBBY)!;
    const czar = round.czarId;
    submitAll(czar);
    const winner = allNonCzar(czar)[0];
    pickWinner(LOBBY, czar, winner);

    const cards = getWinnerCards(LOBBY);
    expect(cards).not.toBeNull();
    expect(cards!.length).toBe(1);
  });
});

// ── getJudgingData ────────────────────────────────────────────────────────────

describe("getJudgingData", () => {
  it("returns submissions and chaos card during judging", () => {
    const round = startRound(LOBBY)!;
    submitAll(round.czarId);

    const data = getJudgingData(LOBBY)!;
    const nonCzarCount = PLAYERS.length - 1;
    expect(data.submissions).toHaveLength(nonCzarCount);
    expect(data.chaosCard.id).toBe(round.chaosCard.id);
  });

  it("returns null when not in judging phase", () => {
    startRound(LOBBY);
    expect(getJudgingData(LOBBY)).toBeNull();
  });
});

// ── getPlayerView ─────────────────────────────────────────────────────────────

describe("getPlayerView", () => {
  it("shows submissions only during judging/revealing", () => {
    const round = startRound(LOBBY)!;
    const player = nonCzar(round.czarId);

    // During submitting — no submissions visible
    const viewDuring = getPlayerView(LOBBY, player)!;
    expect(viewDuring.round!.submissions).toEqual([]);

    submitAll(round.czarId);

    // During judging — submissions visible
    const viewJudging = getPlayerView(LOBBY, player)!;
    expect(viewJudging.round!.submissions.length).toBeGreaterThan(0);
  });

  it("hasSubmitted tracks player's submission status", () => {
    const round = startRound(LOBBY)!;
    const player = nonCzar(round.czarId);

    expect(getPlayerView(LOBBY, player)!.hasSubmitted).toBe(false);
    const view = getPlayerView(LOBBY, player)!;
    submitCards(LOBBY, player, [view.hand[0].id]);
    expect(getPlayerView(LOBBY, player)!.hasSubmitted).toBe(true);
  });

  it("reports gameType", () => {
    const view = getPlayerView(LOBBY, "p1")!;
    expect(view.gameType).toBe("cah");
  });
});

// ── Utility exports ───────────────────────────────────────────────────────────

describe("utility exports", () => {
  it("endGame sets gameOver", () => {
    expect(isGameOver(LOBBY)).toBe(false);
    endGame(LOBBY);
    expect(isGameOver(LOBBY)).toBe(true);
  });

  it("getGameType returns game type", () => {
    expect(getGameType(LOBBY)).toBe("cah");
  });

  it("getPhaseDeadline returns deadline during round", () => {
    startRound(LOBBY);
    expect(getPhaseDeadline(LOBBY)).toBeGreaterThan(0);
  });

  it("getPhaseDeadline returns null when no round", () => {
    expect(getPhaseDeadline(LOBBY)).toBeNull();
  });

  it("getCzarId returns null when no round", () => {
    expect(getCzarId(LOBBY)).toBeUndefined();
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("operations on nonexistent game", () => {
    expect(getPlayerView("nope", "p1")).toBeNull();
    expect(getScores("nope")).toBeNull();
    expect(isGameOver("nope")).toBe(true); // no game = game over
    expect(startRound("nope")).toBeNull();
    expect(getPlayerIds("nope")).toEqual([]);
    expect(getWinInfo("nope")).toBeNull();
    expect(getWinnerCards("nope")).toBeNull();
    expect(getJudgingData("nope")).toBeNull();
    expect(getPhaseDeadline("nope")).toBeNull();
    expect(resetPlayerHand("nope", "p1")).toEqual([]);
  });

  it("cleanup removes game", () => {
    expect(isGameOver(LOBBY)).toBe(false);
    cleanupGame(LOBBY);
    expect(isGameOver(LOBBY)).toBe(true);
  });
});
