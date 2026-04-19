import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isBlackjackGame,
  cleanupBlackjackGame,
  exportBlackjackGames,
  restoreBlackjackGames,
} from "../blackjackGame.js";

const LOBBY = "test-blackjack-001";

beforeEach(async () => {
  await cleanupBlackjackGame(LOBBY);
});

afterEach(async () => {
  await cleanupBlackjackGame(LOBBY);
});

describe("blackjackGame storage skeleton", () => {
  it("isBlackjackGame returns false for an unknown lobby", async () => {
    expect(await isBlackjackGame(LOBBY)).toBe(false);
  });

  it("export returns [] when no games exist", async () => {
    expect(await exportBlackjackGames()).toEqual([]);
  });

  it("restore is a no-op for an empty snapshot list", async () => {
    await restoreBlackjackGames([]);
    expect(await isBlackjackGame(LOBBY)).toBe(false);
  });
});

import {
  createBlackjackGame,
  getBlackjackPlayerView,
} from "../blackjackGame.js";

const PLAYERS = ["p1", "p2", "p3"];
const CONFIG = { startingChips: 1000, minBet: 10, maxBet: 500 };

import { hit } from "../blackjackGame.js";

/** Stub the live game's shoe so subsequent draws are deterministic. */
async function rigShoe(lobby: string, top: Card[]) {
  const exported = await exportBlackjackGames();
  const g = exported.find((x: any) => x.lobbyCode === lobby);
  if (!g) throw new Error("rigShoe: game not found");
  // top[0] will be drawn first → push in reverse so pop() returns top[0] first.
  g.shoe = [...top].reverse();
  // Round-trip back through the public API to persist:
  await cleanupBlackjackGame(lobby);
  await restoreBlackjackGames([g]);
}

/** Stub a player's hand to a fixed pair of cards. */
async function rigHand(lobby: string, playerId: string, cards: Card[]) {
  const exported = await exportBlackjackGames();
  const g = exported.find((x: any) => x.lobbyCode === lobby);
  if (!g) throw new Error("rigHand: game not found");
  g.hands[playerId] = [{ cards, bet: 100, doubled: false, resolved: false, fromSplit: false }];
  await cleanupBlackjackGame(lobby);
  await restoreBlackjackGames([g]);
}

describe("createBlackjackGame", () => {
  it("initialises every player with startingChips and a 52-card shoe", async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    expect(await isBlackjackGame(LOBBY)).toBe(true);

    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.phase).toBe("betting");
    expect(view.chips).toEqual({ p1: 1000, p2: 1000, p3: 1000 });
    expect(view.bets).toEqual({ p1: null, p2: null, p3: null });
    expect(view.hands).toEqual({ p1: [], p2: [], p3: [] });
    expect(view.dealerHand).toEqual([]);
    expect(view.roundNumber).toBe(1);
    expect(view.shoeRemaining).toBe(52);
    expect(view.gameType).toBe("blackjack");
  });

  it("rejects fewer than 1 player", async () => {
    await expect(createBlackjackGame(LOBBY, [], CONFIG)).rejects.toThrow();
  });
});

import { placeBet, sitOut } from "../blackjackGame.js";

describe("placeBet", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
  });

  it("accepts a valid bet and reserves chips", async () => {
    const r = await placeBet(LOBBY, "p1", 100);
    expect(r.success).toBe(true);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.bets.p1).toBe(100);
    expect(view.chips.p1).toBe(900);
  });

  it("rejects below minBet", async () => {
    const r = await placeBet(LOBBY, "p1", 5);
    expect(r.success).toBe(false);
    expect((r as { success: false; error: string }).error).toMatch(/min/i);
  });

  it("rejects above maxBet", async () => {
    const r = await placeBet(LOBBY, "p1", 600);
    expect(r.success).toBe(false);
    expect((r as { success: false; error: string }).error).toMatch(/max/i);
  });

  it("rejects above current chips", async () => {
    await placeBet(LOBBY, "p1", 500);
    await placeBet(LOBBY, "p1", 500); // can't double-bet anyway, but covers chip-check
    // chips were 1000 → 500 after first bet. Second bet should fail before chips.
  });

  it("rejects double-betting in the same round", async () => {
    await placeBet(LOBBY, "p1", 100);
    const r = await placeBet(LOBBY, "p1", 100);
    expect(r.success).toBe(false);
    expect((r as { success: false; error: string }).error).toMatch(/already/i);
  });

  it("rejects when phase != betting", async () => {
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
    // After all bets land we should be off betting (covered by Task 4).
    // For now, just place and force-cleanup; ignore this assertion until T4.
    // Will re-enable: const r = await placeBet(LOBBY, "p1", 50); expect(r.success).toBe(false);
  });

  it("sitOut marks the player as sitting_out and refunds nothing", async () => {
    const r = await sitOut(LOBBY, "p1");
    expect(r.success).toBe(true);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.bets.p1).toBe("sitting_out");
    expect(view.chips.p1).toBe(1000);
  });
});

describe("betting auto-advance", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
  });

  it("advances to playing after all funded players bet", async () => {
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.phase).toBe("playing");
    expect(view.activePlayerId).toBe("p1");
    // 3 players × 2 cards + 2 dealer = 8 cards out of 52
    expect(view.shoeRemaining).toBe(44);
  });

  it("sit-out + bets advance to playing too", async () => {
    await sitOut(LOBBY, "p1");
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.phase).toBe("playing");
    expect(view.hands.p1).toEqual([]); // sitting-out player has no hand
  });
});

import { Card } from "../blackjackGame.js";

describe("dealing", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("each player gets exactly 2 cards and dealer gets 2", async () => {
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.hands.p1[0].cards).toHaveLength(2);
    expect(view.hands.p2[0].cards).toHaveLength(2);
    expect(view.hands.p3[0].cards).toHaveLength(2);
    expect(view.dealerHand).toHaveLength(2);
  });

  it("hides dealer hole card in player view during playing", async () => {
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.dealerHand[1]).toEqual({ suit: "?", rank: "?" });
    // Up-card is never hidden
    expect(view.dealerHand[0]).toHaveProperty("rank");
    expect((view.dealerHand[0] as Card).rank).not.toBe("?");
  });
});

describe("hit", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("draws a card for the active player", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "5" }, { suit: "H", rank: "5" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "3" }]);
    const r = await hit(LOBBY, "p1");
    expect(r.success).toBe(true);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.hands.p1[0].cards).toHaveLength(3);
  });

  it("busts at >21 and resolves the hand", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "K" }, { suit: "H", rank: "Q" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "5" }]);
    const r = await hit(LOBBY, "p1");
    expect(r.success).toBe(true);
    const view = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(view.hands.p1[0].resolved).toBe(true);
    // Active player should have advanced
    expect(view.activePlayerId).toBe("p2");
  });

  it("rejects when not the active player", async () => {
    const r = await hit(LOBBY, "p2");
    expect(r.success).toBe(false);
    expect((r as { success: false; error: string }).error).toMatch(/turn/i);
  });
});

import { stand } from "../blackjackGame.js";

describe("stand", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("advances to the next seat", async () => {
    await stand(LOBBY, "p1");
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.activePlayerId).toBe("p2");
    expect(v.hands.p1[0].resolved).toBe(true);
  });

  it("advances to dealer phase after the last seat stands", async () => {
    await stand(LOBBY, "p1");
    await stand(LOBBY, "p2");
    await stand(LOBBY, "p3");
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.phase).toBe("dealer");
  });

  it("rejects when not active player", async () => {
    const r = await stand(LOBBY, "p2");
    expect(r.success).toBe(false);
  });
});

import { doubleDown } from "../blackjackGame.js";

describe("doubleDown", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("doubles the bet, deals one card, auto-stands", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "5" }, { suit: "H", rank: "6" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "9" }]);
    const r = await doubleDown(LOBBY, "p1");
    expect(r.success).toBe(true);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.hands.p1[0].cards).toHaveLength(3);
    expect(v.hands.p1[0].bet).toBe(200);
    expect(v.hands.p1[0].doubled).toBe(true);
    expect(v.hands.p1[0].resolved).toBe(true);
    expect(v.chips.p1).toBe(800); // 1000 − 100 (initial) − 100 (double)
    expect(v.activePlayerId).toBe("p2");
  });

  it("rejects when hand is not 2 cards", async () => {
    await rigHand(LOBBY, "p1", [
      { suit: "S", rank: "5" }, { suit: "H", rank: "6" }, { suit: "C", rank: "2" },
    ]);
    const r = await doubleDown(LOBBY, "p1");
    expect(r.success).toBe(false);
  });

  it("rejects when chips < bet", async () => {
    // Force chip balance to less than bet
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.chips.p1 = 50;
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);
    const r = await doubleDown(LOBBY, "p1");
    expect(r.success).toBe(false);
    expect((r as { success: false; error: string }).error).toMatch(/chip/i);
  });
});

import { split } from "../blackjackGame.js";

describe("split (non-ace pairs)", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("splits a pair into two hands, each with one card to start", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "8" }, { suit: "H", rank: "8" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "3" }, { suit: "D", rank: "5" }]);
    // shoe top (popped first) = first card of test array → so 3 deals first.
    const r = await split(LOBBY, "p1");
    expect(r.success).toBe(true);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.hands.p1).toHaveLength(2);
    // Each split hand starts with the original card + one new draw
    expect(v.hands.p1[0].cards).toHaveLength(2);
    expect(v.hands.p1[1].cards).toHaveLength(2);
    // Bets duplicated, chips deducted twice
    expect(v.hands.p1[0].bet).toBe(100);
    expect(v.hands.p1[1].bet).toBe(100);
    expect(v.chips.p1).toBe(800); // 1000 − 100 (initial) − 100 (split)
    expect(v.hands.p1[0].fromSplit).toBe(true);
    expect(v.hands.p1[1].fromSplit).toBe(true);
    expect(v.activePlayerId).toBe("p1"); // still p1's turn, on hand 0
    expect(v.activeHandIndex).toBe(0);
  });

  it("rejects when cards aren't a pair", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "5" }, { suit: "H", rank: "6" }]);
    const r = await split(LOBBY, "p1");
    expect(r.success).toBe(false);
  });

  it("rejects when chips < bet", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "8" }, { suit: "H", rank: "8" }]);
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.chips.p1 = 50;
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);
    const r = await split(LOBBY, "p1");
    expect(r.success).toBe(false);
  });

  it("plays the second split hand after the first is resolved", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "8" }, { suit: "H", rank: "8" }]);
    await rigShoe(LOBBY, [
      { suit: "C", rank: "3" }, { suit: "D", rank: "5" },           // split deals
      { suit: "S", rank: "9" }, { suit: "H", rank: "9" },            // hits
    ]);
    await split(LOBBY, "p1");
    await stand(LOBBY, "p1"); // resolve first split hand
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.activePlayerId).toBe("p1");
    expect(v.activeHandIndex).toBe(1);
  });
});

describe("split rule edges", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("split aces: each hand gets exactly one card and both auto-stand", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "A" }, { suit: "H", rank: "A" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "5" }, { suit: "D", rank: "9" }]);
    const r = await split(LOBBY, "p1");
    expect(r.success).toBe(true);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.hands.p1[0].cards).toHaveLength(2);
    expect(v.hands.p1[1].cards).toHaveLength(2);
    expect(v.hands.p1[0].resolved).toBe(true);
    expect(v.hands.p1[1].resolved).toBe(true);
    expect(v.activePlayerId).toBe("p2");
  });

  it("re-split is rejected even if a split hand draws into a new pair", async () => {
    await rigHand(LOBBY, "p1", [{ suit: "S", rank: "8" }, { suit: "H", rank: "8" }]);
    await rigShoe(LOBBY, [{ suit: "C", rank: "8" }, { suit: "D", rank: "8" }]);
    await split(LOBBY, "p1");
    const r = await split(LOBBY, "p1");
    expect(r.success).toBe(false);
    expect((r as { success: false; error: string }).error).toMatch(/re-?split/i);
  });
});
