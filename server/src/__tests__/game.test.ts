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

function nonCzar(czarId: string) {
  return PLAYERS.find((p) => p !== czarId)!;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  cleanupGame(LOBBY);
  createGame(LOBBY, PLAYERS, CHAOS, KNOWLEDGE, { mode: "rounds", value: 3 });
});

afterEach(() => {
  cleanupGame(LOBBY);
});

// ── Round lifecycle ───────────────────────────────────────────────────────────

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
    const czar = round.czarId;
    const submitters = PLAYERS.filter((p) => p !== czar);

    let result = { allSubmitted: false, success: false };
    for (const p of submitters) {
      const view = getPlayerView(LOBBY, p)!;
      result = submitCards(LOBBY, p, [view.hand[0].id]);
    }
    expect(result.allSubmitted).toBe(true);
  });
});

describe("pickWinner + scoring", () => {
  it("winner gains a point", () => {
    const round = startRound(LOBBY)!;
    const czar = round.czarId;
    const submitters = PLAYERS.filter((p) => p !== czar);

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
    const submitters = PLAYERS.filter((p) => p !== czar);

    for (const p of submitters) {
      const view = getPlayerView(LOBBY, p)!;
      submitCards(LOBBY, p, [view.hand[0].id]);
    }

    const result = pickWinner(LOBBY, submitters[0], submitters[1]);
    expect(result.success).toBe(false);
  });
});

// ── Game over detection ───────────────────────────────────────────────────────

describe("isGameOver", () => {
  it("not over after 0 rounds", () => {
    expect(isGameOver(LOBBY)).toBe(false);
  });

  it("over after maxRounds rounds", () => {
    for (let i = 0; i < 3; i++) {
      const round = startRound(LOBBY)!;
      const czar = round.czarId;
      const submitters = PLAYERS.filter((p) => p !== czar);
      for (const p of submitters) {
        const view = getPlayerView(LOBBY, p)!;
        submitCards(LOBBY, p, [view.hand[0].id]);
      }
      pickWinner(LOBBY, czar, submitters[0]);
      advanceRound(LOBBY);
    }
    expect(isGameOver(LOBBY)).toBe(true);
  });
});
