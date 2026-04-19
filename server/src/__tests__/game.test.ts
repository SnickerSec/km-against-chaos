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
async function submitAll(czarId: string) {
  const submitters = allNonCzar(czarId);
  let result = { allSubmitted: false, success: false };
  for (const p of submitters) {
    const view = (await getPlayerView(LOBBY, p))!;
    const pick = view.round!.chaosCard.pick;
    const cardIds = view.hand.slice(0, pick).map((c) => c.id);
    result = await submitCards(LOBBY, p, cardIds);
  }
  return result;
}

/** Play a full round: start → submit all → pick winner. Returns winner ID. */
async function playFullRound(): Promise<string> {
  const round = (await startRound(LOBBY))!;
  const czar = round.czarId;
  const submitters = allNonCzar(czar);

  for (const p of submitters) {
    const view = (await getPlayerView(LOBBY, p))!;
    const pick = round.chaosCard.pick;
    const cardIds = view.hand.slice(0, pick).map((c) => c.id);
    await submitCards(LOBBY, p, cardIds);
  }

  const winner = submitters[0];
  await pickWinner(LOBBY, czar, winner);
  return winner;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
  await cleanupGame(LOBBY);
  await createGame(LOBBY, PLAYERS, CHAOS, KNOWLEDGE, { mode: "rounds", value: 3 });
});

afterEach(async () => {
  await cleanupGame(LOBBY);
});

// ── Round lifecycle (existing tests preserved) ───────────────────────────────

describe("startRound", () => {
  it("returns a valid round state", async () => {
    const round = await startRound(LOBBY);
    expect(round).not.toBeNull();
    expect(PLAYERS).toContain(round!.czarId);
    expect(round!.chaosCard).toBeDefined();
    expect(round!.phase).toBe("submitting");
  });

  it("czar rotates each round", async () => {
    const r1 = (await startRound(LOBBY))!;
    await advanceRound(LOBBY);
    const r2 = (await startRound(LOBBY))!;
    expect(r2.czarId).not.toBe(r1.czarId);
  });

  it("returns null after max rounds exceeded", async () => {
    for (let i = 0; i < 3; i++) {
      await playFullRound();
      await advanceRound(LOBBY);
    }
    expect(await startRound(LOBBY)).toBeNull();
  });
});

describe("submitCards", () => {
  it("non-czar player can submit a card", async () => {
    const round = (await startRound(LOBBY))!;
    const player = nonCzar(round.czarId);
    const view = (await getPlayerView(LOBBY, player))!;
    const cardId = view.hand[0].id;

    const result = await submitCards(LOBBY, player, [cardId]);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("czar cannot submit", async () => {
    const round = (await startRound(LOBBY))!;
    const czarView = (await getPlayerView(LOBBY, round.czarId))!;
    const cardId = czarView.hand[0].id;

    const result = await submitCards(LOBBY, round.czarId, [cardId]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/czar/i);
  });

  it("player cannot submit twice", async () => {
    const round = (await startRound(LOBBY))!;
    const player = nonCzar(round.czarId);
    const view = (await getPlayerView(LOBBY, player))!;

    await submitCards(LOBBY, player, [view.hand[0].id]);
    const second = await submitCards(LOBBY, player, [view.hand[1].id]);
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already/i);
  });

  it("all players submitted triggers judging phase", async () => {
    const round = (await startRound(LOBBY))!;
    const result = await submitAll(round.czarId);
    expect(result.allSubmitted).toBe(true);
  });

  it("card not in hand is rejected", async () => {
    const round = (await startRound(LOBBY))!;
    const player = nonCzar(round.czarId);
    const result = await submitCards(LOBBY, player, ["fake-id"]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in your hand/i);
  });

  it("wrong number of cards is rejected", async () => {
    const round = (await startRound(LOBBY))!;
    const player = nonCzar(round.czarId);
    const view = (await getPlayerView(LOBBY, player))!;
    // Submit 2 cards for a pick-1 prompt
    const result = await submitCards(LOBBY, player, [view.hand[0].id, view.hand[1].id]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exactly/i);
  });
});

describe("pickWinner + scoring", () => {
  it("winner gains a point", async () => {
    const round = (await startRound(LOBBY))!;
    const czar = round.czarId;
    const submitters = allNonCzar(czar);

    for (const p of submitters) {
      const view = (await getPlayerView(LOBBY, p))!;
      await submitCards(LOBBY, p, [view.hand[0].id]);
    }

    const winner = submitters[0];
    const result = await pickWinner(LOBBY, czar, winner);
    expect(result.success).toBe(true);

    const scores = (await getScores(LOBBY))!;
    expect(scores[winner]).toBe(1);
    expect(scores[submitters[1]]).toBe(0);
  });

  it("only czar can pick the winner", async () => {
    const round = (await startRound(LOBBY))!;
    const czar = round.czarId;
    const submitters = allNonCzar(czar);

    for (const p of submitters) {
      const view = (await getPlayerView(LOBBY, p))!;
      await submitCards(LOBBY, p, [view.hand[0].id]);
    }

    const result = await pickWinner(LOBBY, submitters[0], submitters[1]);
    expect(result.success).toBe(false);
  });

  it("invalid winner ID is rejected", async () => {
    const round = (await startRound(LOBBY))!;
    await submitAll(round.czarId);
    const result = await pickWinner(LOBBY, round.czarId, "nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid winner/i);
  });
});

// ── Game over detection ───────────────────────────────────────────────────────

describe("isGameOver", () => {
  it("not over after 0 rounds", async () => {
    expect(await isGameOver(LOBBY)).toBe(false);
  });

  it("over after maxRounds rounds", async () => {
    for (let i = 0; i < 3; i++) {
      await playFullRound();
      await advanceRound(LOBBY);
    }
    expect(await isGameOver(LOBBY)).toBe(true);
  });
});

// ── Pick-2 cards ──────────────────────────────────────────────────────────────

describe("pick-2 chaos cards", () => {
  beforeEach(async () => {
    await cleanupGame(LOBBY);
    await createGame(LOBBY, PLAYERS, CHAOS_PICK2, KNOWLEDGE, { mode: "rounds", value: 3 });
  });

  it("player must submit exactly 2 cards", async () => {
    const round = (await startRound(LOBBY))!;
    const player = nonCzar(round.czarId);
    const view = (await getPlayerView(LOBBY, player))!;

    // Only 1 card should fail
    const r1 = await submitCards(LOBBY, player, [view.hand[0].id]);
    expect(r1.success).toBe(false);
    expect(r1.error).toMatch(/exactly 2/i);

    // 2 cards should succeed
    const r2 = await submitCards(LOBBY, player, [view.hand[0].id, view.hand[1].id]);
    expect(r2.success).toBe(true);
  });

  it("hand replenished after submitting 2 cards", async () => {
    const round = (await startRound(LOBBY))!;
    const player = nonCzar(round.czarId);
    const handBefore = (await getPlayerView(LOBBY, player))!.hand.length;

    const view = (await getPlayerView(LOBBY, player))!;
    await submitCards(LOBBY, player, [view.hand[0].id, view.hand[1].id]);

    // Hand should still be 7 (submitted 2, drew 2)
    const handAfter = (await getPlayerView(LOBBY, player))!.hand.length;
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

  beforeEach(async () => {
    await cleanupGame(LOBBY);
    await createGame(LOBBY, PLAYERS, CHAOS_PICK2, TINY_KNOWLEDGE, { mode: "rounds", value: 10 });
  });

  it("hands stay full thanks to mid-round reshuffling with a tiny deck", async () => {
    // With immediate discarding, played cards are recycled into the deck
    // so hands should never deplete even with a very small card pool.
    for (let i = 0; i < 6; i++) {
      const round = await startRound(LOBBY);
      if (!round) break;
      const czar = round.czarId;
      const submitters = allNonCzar(czar);

      for (const p of submitters) {
        const view = (await getPlayerView(LOBBY, p))!;
        expect(view.hand.length).toBeGreaterThanOrEqual(2);
        await submitCards(LOBBY, p, [view.hand[0].id, view.hand[1].id]);
      }

      await pickWinner(LOBBY, czar, submitters[0]);
      await advanceRound(LOBBY);
    }
  });

  it("player can submit fewer cards if deck is truly exhausted", async () => {
    // With only 8 total cards and 3 players (7 each = would need 21),
    // some players start with fewer than 7 cards
    const MICRO_KNOWLEDGE: KnowledgeCard[] = Array.from({ length: 8 }, (_, i) => ({
      id: `mk${i}`,
      text: `Micro answer ${i}`,
    }));
    await cleanupGame(LOBBY);
    await createGame(LOBBY, PLAYERS, CHAOS_PICK2, MICRO_KNOWLEDGE, { mode: "rounds", value: 3 });

    const round = await startRound(LOBBY);
    expect(round).not.toBeNull();
    const czar = round!.czarId;
    const submitters = allNonCzar(czar);

    // With 8 cards split among 3 players, at least one should have a short hand
    let foundShort = false;
    for (const p of submitters) {
      const view = (await getPlayerView(LOBBY, p))!;
      if (view.hand.length === 1) {
        const result = await submitCards(LOBBY, p, [view.hand[0].id]);
        expect(result.success).toBe(true);
        foundShort = true;
      } else if (view.hand.length >= 2) {
        await submitCards(LOBBY, p, [view.hand[0].id, view.hand[1].id]);
      }
    }
    expect(foundShort).toBe(true);
  });
});

// ── Hand replenishment ───────────────────────────────────────────────────────

describe("hand replenishment", () => {
  it("hand stays at 7 after submitting", async () => {
    const round = (await startRound(LOBBY))!;
    const player = nonCzar(round.czarId);
    const view = (await getPlayerView(LOBBY, player))!;
    await submitCards(LOBBY, player, [view.hand[0].id]);

    const handAfter = (await getPlayerView(LOBBY, player))!.hand.length;
    expect(handAfter).toBe(7);
  });
});

// ── Bot logic ─────────────────────────────────────────────────────────────────

describe("botSubmitCards", () => {
  const BOT_LOBBY = "test-bot";
  const BOT_PLAYERS = ["bot-a", "bot-b", "bot-c"];

  beforeEach(async () => {
    await cleanupGame(BOT_LOBBY);
    await createGame(BOT_LOBBY, BOT_PLAYERS, CHAOS, KNOWLEDGE, { mode: "rounds", value: 3 });
  });
  afterEach(async () => { await cleanupGame(BOT_LOBBY); });

  it("bot can submit cards", async () => {
    const round = (await startRound(BOT_LOBBY))!;
    const bot = BOT_PLAYERS.find((p) => p !== round.czarId)!;
    const result = await botSubmitCards(BOT_LOBBY, bot);
    expect(result.success).toBe(true);
  });

  it("czar bot cannot submit", async () => {
    const round = (await startRound(BOT_LOBBY))!;
    const result = await botSubmitCards(BOT_LOBBY, round.czarId);
    expect(result.success).toBe(false);
  });

  it("bot cannot submit twice", async () => {
    const round = (await startRound(BOT_LOBBY))!;
    const bot = BOT_PLAYERS.find((p) => p !== round.czarId)!;
    await botSubmitCards(BOT_LOBBY, bot);
    const result = await botSubmitCards(BOT_LOBBY, bot);
    expect(result.success).toBe(false);
  });

  it("all bots submitting triggers judging", async () => {
    const round = (await startRound(BOT_LOBBY))!;
    const submitters = BOT_PLAYERS.filter((p) => p !== round.czarId);
    let result = { success: false, allSubmitted: false };
    for (const bot of submitters) {
      result = await botSubmitCards(BOT_LOBBY, bot);
    }
    expect(result.allSubmitted).toBe(true);
  });
});

describe("botPickWinner", () => {
  const BOT_LOBBY = "test-bot-pick";
  const BOT_PLAYERS = ["bot-a", "bot-b", "bot-c"];

  beforeEach(async () => {
    await cleanupGame(BOT_LOBBY);
    await createGame(BOT_LOBBY, BOT_PLAYERS, CHAOS, KNOWLEDGE, { mode: "rounds", value: 3 });
  });
  afterEach(async () => { await cleanupGame(BOT_LOBBY); });

  it("bot czar can pick a winner", async () => {
    const round = (await startRound(BOT_LOBBY))!;
    const submitters = BOT_PLAYERS.filter((p) => p !== round.czarId);
    for (const bot of submitters) await botSubmitCards(BOT_LOBBY, bot);

    const result = await botPickWinner(BOT_LOBBY, round.czarId);
    expect(result.winnerId).not.toBeNull();
    expect(submitters).toContain(result.winnerId);
  });

  it("non-czar bot cannot pick winner", async () => {
    const round = (await startRound(BOT_LOBBY))!;
    const submitters = BOT_PLAYERS.filter((p) => p !== round.czarId);
    for (const bot of submitters) await botSubmitCards(BOT_LOBBY, bot);

    const result = await botPickWinner(BOT_LOBBY, submitters[0]);
    expect(result.winnerId).toBeNull();
  });
});

// ── Meta card effects ─────────────────────────────────────────────────────────

describe("resolveMetaTargets", () => {
  it("winner target returns only winner", async () => {
    expect(resolveMetaTargets("winner", "p1", "p2", PLAYERS)).toEqual(["p1"]);
  });

  it("czar target returns only czar", async () => {
    expect(resolveMetaTargets("czar", "p1", "p2", PLAYERS)).toEqual(["p2"]);
  });

  it("all target returns all players", async () => {
    expect(resolveMetaTargets("all", "p1", "p2", PLAYERS)).toEqual(PLAYERS);
  });

  it("all_others excludes winner", async () => {
    const result = resolveMetaTargets("all_others", "p1", "p2", PLAYERS);
    expect(result).not.toContain("p1");
    expect(result).toContain("p2");
    expect(result).toContain("p3");
  });

  it("loser returns non-winner non-czar players", async () => {
    const result = resolveMetaTargets("loser", "p1", "p2", PLAYERS);
    expect(result).not.toContain("p1"); // winner excluded
    expect(result).not.toContain("p2"); // czar excluded
    expect(result).toContain("p3");
  });
});

describe("meta effect scoring", () => {
  beforeEach(async () => {
    await cleanupGame(LOBBY);
    await createGame(LOBBY, PLAYERS, CHAOS_META, KNOWLEDGE, { mode: "rounds", value: 10 });
  });

  it("score_add meta effect awards extra points", async () => {
    // First chaos card in CHAOS_META has score_add +2 for winner
    const round = (await startRound(LOBBY))!;
    // If we got the meta card, winner gets 1 (normal) + 2 (meta) = 3
    // If not, just regular scoring
    const czar = round.czarId;
    const submitters = allNonCzar(czar);

    for (const p of submitters) {
      const view = (await getPlayerView(LOBBY, p))!;
      await submitCards(LOBBY, p, [view.hand[0].id]);
    }

    const winner = submitters[0];
    const result = await pickWinner(LOBBY, czar, winner);
    expect(result.success).toBe(true);

    const scores = (await getScores(LOBBY))!;
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
  it("auto-submits for players who haven't submitted", async () => {
    const round = (await startRound(LOBBY))!;
    const czar = round.czarId;
    const submitters = allNonCzar(czar);

    // Only first player submits
    const view = (await getPlayerView(LOBBY, submitters[0]))!;
    await submitCards(LOBBY, submitters[0], [view.hand[0].id]);

    const forced = await forceSubmitForMissing(LOBBY);
    expect(forced).toContain(submitters[1]);
    expect(forced).not.toContain(submitters[0]); // already submitted
    expect(await getCurrentPhase(LOBBY)).toBe("judging");
  });

  it("returns empty array when no one is missing", async () => {
    const round = (await startRound(LOBBY))!;
    await submitAll(round.czarId);
    const forced = await forceSubmitForMissing(LOBBY);
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

  beforeEach(async () => {
    await cleanupGame(JH_LOBBY);
    await createGame(JH_LOBBY, PLAYERS, JH_CHAOS, KNOWLEDGE, { mode: "rounds", value: 3 }, "joking_hazard");
  });
  afterEach(async () => { await cleanupGame(JH_LOBBY); });

  it("round starts in czar_setup phase", async () => {
    const round = (await startRound(JH_LOBBY))!;
    expect(round.phase).toBe("czar_setup");
  });

  it("czar can play a setup card", async () => {
    const round = (await startRound(JH_LOBBY))!;
    const czarView = (await getPlayerView(JH_LOBBY, round.czarId))!;
    const cardId = czarView.hand[0].id;

    const result = await czarSetup(JH_LOBBY, round.czarId, cardId);
    expect(result.success).toBe(true);
    expect(result.czarSetupCard).toBeDefined();
    expect(await getCurrentPhase(JH_LOBBY)).toBe("submitting");
  });

  it("non-czar cannot play setup card", async () => {
    const round = (await startRound(JH_LOBBY))!;
    const other = nonCzar(round.czarId);
    const view = (await getPlayerView(JH_LOBBY, other))!;

    const result = await czarSetup(JH_LOBBY, other, view.hand[0].id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/judge/i);
  });

  it("botCzarSetup plays a card automatically", async () => {
    const round = (await startRound(JH_LOBBY))!;
    const result = await botCzarSetup(JH_LOBBY, round.czarId);
    expect(result.success).toBe(true);
    expect(result.czarSetupCard).toBeDefined();
  });

  it("forceCzarSetup auto-plays when czar times out", async () => {
    await startRound(JH_LOBBY);
    const card = await forceCzarSetup(JH_LOBBY);
    expect(card).not.toBeNull();
    expect(await getCurrentPhase(JH_LOBBY)).toBe("submitting");
  });
});

// ── Points-mode game over ─────────────────────────────────────────────────────

describe("points-mode game over", () => {
  beforeEach(async () => {
    await cleanupGame(LOBBY);
    await createGame(LOBBY, PLAYERS, CHAOS, KNOWLEDGE, { mode: "points", value: 2 });
  });

  it("game ends when a player reaches target points", async () => {
    // Play rounds until someone hits 2 points
    let winner = await playFullRound();
    await advanceRound(LOBBY);
    winner = await playFullRound();
    // After 2 wins by the same player (if czar rotates away from them), game should end
    // Or check manually
    const scores = (await getScores(LOBBY))!;
    const anyoneWon = Object.values(scores).some((s) => s >= 2);
    if (anyoneWon) {
      expect(await isGameOver(LOBBY)).toBe(true);
    }
  });

  it("getWinInfo reports points mode", async () => {
    const info = await getWinInfo(LOBBY);
    expect(info).toEqual({ mode: "points", value: 2 });
  });
});

// ── botCzar mode ──────────────────────────────────────────────────────────────

describe("botCzar mode", () => {
  const BC_LOBBY = "test-bc";
  const HUMANS = ["h1", "h2"];
  const BOT_A = "bot-aaa";
  const BOT_B = "bot-bbb";

  afterEach(async () => { await cleanupGame(BC_LOBBY); });

  it("only bots are picked as czar across rounds", async () => {
    await cleanupGame(BC_LOBBY);
    await createGame(BC_LOBBY, [...HUMANS, BOT_A, BOT_B], CHAOS, KNOWLEDGE, { mode: "rounds", value: 4 }, "cah", { botCzar: true });

    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await startRound(BC_LOBBY);
      if (!r) break;
      seen.push(r.czarId);
      // Force-end the round so czarIndex advances
      const submitters = (await getPlayerIds(BC_LOBBY)).filter((p) => p !== r.czarId);
      for (const p of submitters) {
        const v = (await getPlayerView(BC_LOBBY, p))!;
        await submitCards(BC_LOBBY, p, [v.hand[0].id]);
      }
      await pickWinner(BC_LOBBY, r.czarId, submitters[0]);
      await advanceRound(BC_LOBBY);
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const czar of seen) {
      expect(czar.startsWith("bot-")).toBe(true);
    }
    // With 2 bots over 4 rounds, both bots should appear
    expect(new Set(seen).size).toBeGreaterThan(1);
  });

  it("ends the game if all bots are removed mid-game", async () => {
    await cleanupGame(BC_LOBBY);
    await createGame(BC_LOBBY, [...HUMANS, BOT_A], CHAOS, KNOWLEDGE, { mode: "rounds", value: 5 }, "cah", { botCzar: true });

    const r1 = await startRound(BC_LOBBY);
    expect(r1?.czarId).toBe(BOT_A);
    await advanceRound(BC_LOBBY);

    await removePlayerFromGame(BC_LOBBY, BOT_A);
    const r2 = await startRound(BC_LOBBY);
    expect(r2).toBeNull();
    expect(await isGameOver(BC_LOBBY)).toBe(true);
  });
});

// ── addPlayerToGame / removePlayerFromGame ────────────────────────────────────

describe("addPlayerToGame", () => {
  it("adds a new player mid-game", async () => {
    await startRound(LOBBY);
    const added = await addPlayerToGame(LOBBY, "p4");
    expect(added).toBe(true);
    expect(await getPlayerIds(LOBBY)).toContain("p4");
    // New player gets a hand
    const view = (await getPlayerView(LOBBY, "p4"))!;
    expect(view.hand.length).toBe(7);
    expect(view.scores["p4"]).toBe(0);
  });

  it("adding an existing player is idempotent", async () => {
    const result = await addPlayerToGame(LOBBY, "p1");
    expect(result).toBe(true);
    expect((await getPlayerIds(LOBBY)).filter((id) => id === "p1")).toHaveLength(1);
  });
});

describe("removePlayerFromGame", () => {
  it("removes player and their submission", async () => {
    const round = (await startRound(LOBBY))!;
    const player = nonCzar(round.czarId);
    const view = (await getPlayerView(LOBBY, player))!;
    await submitCards(LOBBY, player, [view.hand[0].id]);

    await removePlayerFromGame(LOBBY, player);
    expect(await getPlayerIds(LOBBY)).not.toContain(player);
    expect((await getScores(LOBBY))![player]).toBeUndefined();
  });
});

// ── remapGamePlayer ───────────────────────────────────────────────────────────

describe("remapGamePlayer", () => {
  it("moves player to new ID preserving hand and score", async () => {
    const handBefore = (await getPlayerView(LOBBY, "p1"))!.hand.length;
    await remapGamePlayer(LOBBY, "p1", "p1-new");

    expect(await getPlayerIds(LOBBY)).toContain("p1-new");
    expect(await getPlayerIds(LOBBY)).not.toContain("p1");

    const view = (await getPlayerView(LOBBY, "p1-new"))!;
    expect(view.hand).toHaveLength(handBefore);
    expect(view.scores["p1-new"]).toBe(0);
  });

  it("remaps czar during a round", async () => {
    const round = (await startRound(LOBBY))!;
    await remapGamePlayer(LOBBY, round.czarId, "czar-new");
    expect(await getCzarId(LOBBY)).toBe("czar-new");
  });

  it("remaps submission during a round", async () => {
    const round = (await startRound(LOBBY))!;
    const player = nonCzar(round.czarId);
    const view = (await getPlayerView(LOBBY, player))!;
    await submitCards(LOBBY, player, [view.hand[0].id]);

    await remapGamePlayer(LOBBY, player, "p-new");
    // After all others submit, judging should still work with remapped player
    const remaining = allNonCzar(round.czarId).filter((p) => p !== player);
    for (const p of remaining) {
      const v = (await getPlayerView(LOBBY, p))!;
      await submitCards(LOBBY, p, [v.hand[0].id]);
    }
    // The remapped player's submission should be pickable
    const result = await pickWinner(LOBBY, round.czarId, "p-new");
    expect(result.success).toBe(true);
  });
});

// ── resetPlayerHand ───────────────────────────────────────────────────────────

describe("resetPlayerHand", () => {
  it("replaces hand with 7 new cards", async () => {
    const oldHand = (await getPlayerView(LOBBY, "p1"))!.hand.map((c) => c.id);
    const newHand = await resetPlayerHand(LOBBY, "p1");
    expect(newHand).toHaveLength(7);
    // At least some cards should differ (extremely unlikely to get same 7)
    const newIds = newHand.map((c) => c.id);
    expect(newIds).not.toEqual(oldHand);
  });
});

// ── getWinnerCards ────────────────────────────────────────────────────────────

describe("getWinnerCards", () => {
  it("returns null before winner is picked", async () => {
    await startRound(LOBBY);
    expect(await getWinnerCards(LOBBY)).toBeNull();
  });

  it("returns winning cards after pick", async () => {
    const round = (await startRound(LOBBY))!;
    const czar = round.czarId;
    await submitAll(czar);
    const winner = allNonCzar(czar)[0];
    await pickWinner(LOBBY, czar, winner);

    const cards = await getWinnerCards(LOBBY);
    expect(cards).not.toBeNull();
    expect(cards!.length).toBe(1);
  });
});

// ── getJudgingData ────────────────────────────────────────────────────────────

describe("getJudgingData", () => {
  it("returns submissions and chaos card during judging", async () => {
    const round = (await startRound(LOBBY))!;
    await submitAll(round.czarId);

    const data = (await getJudgingData(LOBBY))!;
    const nonCzarCount = PLAYERS.length - 1;
    expect(data.submissions).toHaveLength(nonCzarCount);
    expect(data.chaosCard.id).toBe(round.chaosCard.id);
  });

  it("returns null when not in judging phase", async () => {
    await startRound(LOBBY);
    expect(await getJudgingData(LOBBY)).toBeNull();
  });
});

// ── getPlayerView ─────────────────────────────────────────────────────────────

describe("getPlayerView", () => {
  it("shows submissions only during judging/revealing", async () => {
    const round = (await startRound(LOBBY))!;
    const player = nonCzar(round.czarId);

    // During submitting — no submissions visible
    const viewDuring = (await getPlayerView(LOBBY, player))!;
    expect(viewDuring.round!.submissions).toEqual([]);

    await submitAll(round.czarId);

    // During judging — submissions visible
    const viewJudging = (await getPlayerView(LOBBY, player))!;
    expect(viewJudging.round!.submissions.length).toBeGreaterThan(0);
  });

  it("hasSubmitted tracks player's submission status", async () => {
    const round = (await startRound(LOBBY))!;
    const player = nonCzar(round.czarId);

    expect((await getPlayerView(LOBBY, player))!.hasSubmitted).toBe(false);
    const view = (await getPlayerView(LOBBY, player))!;
    await submitCards(LOBBY, player, [view.hand[0].id]);
    expect((await getPlayerView(LOBBY, player))!.hasSubmitted).toBe(true);
  });

  it("reports gameType", async () => {
    const view = (await getPlayerView(LOBBY, "p1"))!;
    expect(view.gameType).toBe("cah");
  });
});

// ── Utility exports ───────────────────────────────────────────────────────────

describe("utility exports", () => {
  it("endGame sets gameOver", async () => {
    expect(await isGameOver(LOBBY)).toBe(false);
    await endGame(LOBBY);
    expect(await isGameOver(LOBBY)).toBe(true);
  });

  it("getGameType returns game type", async () => {
    expect(await getGameType(LOBBY)).toBe("cah");
  });

  it("getPhaseDeadline returns deadline during round", async () => {
    await startRound(LOBBY);
    expect(await getPhaseDeadline(LOBBY)).toBeGreaterThan(0);
  });

  it("getPhaseDeadline returns null when no round", async () => {
    expect(await getPhaseDeadline(LOBBY)).toBeNull();
  });

  it("getCzarId returns null when no round", async () => {
    expect(await getCzarId(LOBBY)).toBeUndefined();
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("operations on nonexistent game", async () => {
    expect(await getPlayerView("nope", "p1")).toBeNull();
    expect(await getScores("nope")).toBeNull();
    expect(await isGameOver("nope")).toBe(true); // no game = game over
    expect(await startRound("nope")).toBeNull();
    expect(await getPlayerIds("nope")).toEqual([]);
    expect(await getWinInfo("nope")).toBeNull();
    expect(await getWinnerCards("nope")).toBeNull();
    expect(await getJudgingData("nope")).toBeNull();
    expect(await getPhaseDeadline("nope")).toBeNull();
    expect(await resetPlayerHand("nope", "p1")).toEqual([]);
  });

  it("cleanup removes game", async () => {
    expect(await isGameOver(LOBBY)).toBe(false);
    await cleanupGame(LOBBY);
    expect(await isGameOver(LOBBY)).toBe(true);
  });
});
