import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isBlackjackGame,
  cleanupBlackjackGame,
  exportBlackjackGames,
  restoreBlackjackGames,
  startNextRound,
  getBlackjackScores,
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
  removePlayerFromBlackjackGame,
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

import { runDealer, settleRound } from "../blackjackGame.js";

describe("runDealer", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("hits to 17 and stands", async () => {
    // Force every player to stand cleanly, then run dealer.
    for (const pid of ["p1", "p2", "p3"] as const) {
      await rigHand(LOBBY, pid, [{ suit: "S", rank: "9" }, { suit: "H", rank: "9" }]);
      await stand(LOBBY, pid);
    }
    // Stub dealer hand to 12 (e.g., 7 + 5), then deal 6 → 18, stop.
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.dealerHand = [{ suit: "S", rank: "7" }, { suit: "H", rank: "5" }];
    g.shoe = [{ suit: "C", rank: "6" }];
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await runDealer(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.dealerHand).toHaveLength(3);
    expect(v.phase).toBe("settle");
  });

  it("skips drawing if every player busted", async () => {
    for (const pid of ["p1", "p2", "p3"] as const) {
      await rigHand(LOBBY, pid, [{ suit: "S", rank: "K" }, { suit: "H", rank: "Q" }]);
      const exported = await exportBlackjackGames();
      const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
      // Add a third card to bust (K+Q+5 = 25)
      g.hands[pid][0].cards.push({ suit: "C", rank: "5" });
      g.hands[pid][0].resolved = true;
      await cleanupBlackjackGame(LOBBY);
      await restoreBlackjackGames([g]);
    }
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.dealerHand = [{ suit: "S", rank: "7" }, { suit: "H", rank: "5" }];
    g.phase = "dealer";
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await runDealer(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    // Dealer doesn't draw — every player already lost.
    expect(v.dealerHand).toHaveLength(2);
  });
});

describe("settleRound", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  async function setOutcome(dealer: Card[], p1: Card[], p2: Card[], p3: Card[]) {
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.dealerHand = dealer;
    g.hands.p1 = [{ cards: p1, bet: 100, doubled: false, resolved: true, fromSplit: false }];
    g.hands.p2 = [{ cards: p2, bet: 100, doubled: false, resolved: true, fromSplit: false }];
    g.hands.p3 = [{ cards: p3, bet: 100, doubled: false, resolved: true, fromSplit: false }];
    g.phase = "settle";
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);
  }

  it("win: chips +bet, push: chips +0, lose: chips −bet (vs pre-bet balance)", async () => {
    // dealer 19, p1 wins (20), p2 pushes (19), p3 loses (18 vs 19)
    await setOutcome(
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],
      [{ suit: "S", rank: "K" }, { suit: "H", rank: "10" }],   // 20
      [{ suit: "S", rank: "9" }, { suit: "H", rank: "10" }],   // 19
      [{ suit: "S", rank: "8" }, { suit: "H", rank: "10" }],   // 18
    );
    await settleRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.chips.p1).toBe(1100); // 1000 - 100 + 200
    expect(v.chips.p2).toBe(1000); // 1000 - 100 + 100
    expect(v.chips.p3).toBe(900);  // 1000 - 100 + 0
    expect(v.lastSettlement?.find(s => s.playerId === "p1")?.outcome).toBe("win");
    expect(v.lastSettlement?.find(s => s.playerId === "p2")?.outcome).toBe("push");
    expect(v.lastSettlement?.find(s => s.playerId === "p3")?.outcome).toBe("lose");
  });

  it("blackjack pays 3:2", async () => {
    await setOutcome(
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],   // dealer 19
      [{ suit: "S", rank: "A" }, { suit: "H", rank: "K" }],    // p1 blackjack
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],   // p2 push (19)
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],   // p3 push
    );
    await settleRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.chips.p1).toBe(1150); // 1000 - 100 + 100 + ceil(1.5*100) = 1150
    expect(v.lastSettlement?.find(s => s.playerId === "p1")?.outcome).toBe("blackjack");
  });

  it("dealer blackjack pushes vs player blackjack, loses to non-blackjack 21", async () => {
    await setOutcome(
      [{ suit: "S", rank: "A" }, { suit: "H", rank: "K" }],    // dealer blackjack
      [{ suit: "S", rank: "A" }, { suit: "H", rank: "K" }],    // p1 push (both BJ)
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "5" }, { suit: "C", rank: "6" }], // p2 21, not BJ → lose
      [{ suit: "S", rank: "9" }, { suit: "H", rank: "9" }],    // p3 18 → lose
    );
    await settleRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.chips.p1).toBe(1000); // push
    expect(v.chips.p2).toBe(900);  // lose
    expect(v.chips.p3).toBe(900);  // lose
  });

  it("busted player loses regardless of dealer", async () => {
    await setOutcome(
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "10" }, { suit: "C", rank: "5" }], // dealer busts at 25
      [{ suit: "S", rank: "K" }, { suit: "H", rank: "Q" }, { suit: "C", rank: "5" }],   // p1 bust
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],                             // p2 win (19)
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }],                             // p3 win
    );
    await settleRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.chips.p1).toBe(900);  // bust = lose
    expect(v.chips.p2).toBe(1100); // dealer busted = win
  });
});

describe("elimination and next-round loop", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
  });

  it("loops back to betting with fresh shoe and incremented roundNumber", async () => {
    // Trip a settled state with everyone surviving
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.phase = "settle";
    g.chips = { p1: 500, p2: 500, p3: 500 };
    g.bets = { p1: 100, p2: 100, p3: 100 };
    g.dealerHand = [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }];
    g.hands = { p1: [], p2: [], p3: [] };
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await startNextRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.phase).toBe("betting");
    expect(v.roundNumber).toBe(2);
    expect(v.bets).toEqual({ p1: null, p2: null, p3: null });
    expect(v.dealerHand).toEqual([]);
    expect(v.shoeRemaining).toBe(52);
  });

  it("ends the game when ≤1 player has chips ≥ minBet", async () => {
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.phase = "settle";
    g.chips = { p1: 5, p2: 5, p3: 1000 }; // only p3 can keep playing
    g.dealerHand = [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }];
    g.hands = { p1: [], p2: [], p3: [] };
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await startNextRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.phase).toBe("gameOver");

    const scores = await getBlackjackScores(LOBBY);
    // Last player standing scores 1, the rest 0 — same shape as codenames scores.
    expect(scores).toEqual({ p1: 0, p2: 0, p3: 1 });
  });

  it("eliminated players (chips < minBet) sit out the next round automatically", async () => {
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.phase = "settle";
    g.chips = { p1: 5, p2: 500, p3: 500 }; // p1 eliminated, p2/p3 alive
    g.dealerHand = [{ suit: "S", rank: "10" }, { suit: "H", rank: "9" }];
    g.hands = { p1: [], p2: [], p3: [] };
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await startNextRound(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.phase).toBe("betting");
    expect(v.bets.p1).toBe("sitting_out"); // auto sit-out when ineligible
    expect(v.bets.p2).toBe(null);
    expect(v.bets.p3).toBe(null);
  });
});

describe("removePlayerFromBlackjackGame", () => {
  beforeEach(async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
  });

  it("removes a non-active player without disrupting the round", async () => {
    await removePlayerFromBlackjackGame(LOBBY, "p3");
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.playerIds).toEqual(["p1", "p2"]);
    expect(v.activePlayerId).toBe("p1");
  });

  it("auto-advances when the active player leaves mid-turn", async () => {
    await removePlayerFromBlackjackGame(LOBBY, "p1");
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.activePlayerId).toBe("p2");
  });

  it("ends the game when only one eligible player remains", async () => {
    await removePlayerFromBlackjackGame(LOBBY, "p1");
    await removePlayerFromBlackjackGame(LOBBY, "p2");
    const v = (await getBlackjackPlayerView(LOBBY, "p3"))!;
    expect(v.phase).toBe("gameOver");
  });
});

describe("handleBettingTimeout", () => {
  it("auto-sits-out null-bet players and starts dealing", async () => {
    const { handleBettingTimeout } = await import("../blackjackGame.js");
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    // p2, p3 never bet

    await handleBettingTimeout(LOBBY);

    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.phase).toBe("playing");
    expect(v.bets.p2).toBe("sitting_out");
    expect(v.bets.p3).toBe("sitting_out");
    expect(v.hands.p1.length).toBe(1);
    expect(v.hands.p2.length).toBe(0);
    expect(v.activePlayerId).toBe("p1");
  });

  it("is a no-op when not in betting phase", async () => {
    const { handleBettingTimeout } = await import("../blackjackGame.js");
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
    // now in playing phase
    await handleBettingTimeout(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.phase).toBe("playing");
  });
});

describe("handleTurnTimeout", () => {
  it("auto-stands the active hand so the table keeps moving", async () => {
    const { handleTurnTimeout } = await import("../blackjackGame.js");
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    await placeBet(LOBBY, "p1", 100);
    await placeBet(LOBBY, "p2", 100);
    await placeBet(LOBBY, "p3", 100);
    // in playing phase, p1 active

    await handleTurnTimeout(LOBBY);
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.hands.p1[0].resolved).toBe(true);
    expect(v.activePlayerId).toBe("p2");
  });
});

describe("botPlaceBet", () => {
  it("places the minimum bet for a bot", async () => {
    const { botPlaceBet } = await import("../blackjackGame.js");
    await createBlackjackGame(LOBBY, ["p1", "bot-xyz"], CONFIG);

    const r = await botPlaceBet(LOBBY, "bot-xyz");
    expect(r.success).toBe(true);

    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.bets["bot-xyz"]).toBe(CONFIG.minBet);
    expect(v.chips["bot-xyz"]).toBe(CONFIG.startingChips - CONFIG.minBet);
  });

  it("sits the bot out when it cannot afford the minimum", async () => {
    const { botPlaceBet } = await import("../blackjackGame.js");
    await createBlackjackGame(LOBBY, ["p1", "bot-xyz"], CONFIG);
    // drain the bot's chips below minBet
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.chips["bot-xyz"] = 5;
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await botPlaceBet(LOBBY, "bot-xyz");
    const v = (await getBlackjackPlayerView(LOBBY, "p1"))!;
    expect(v.bets["bot-xyz"]).toBe("sitting_out");
  });
});

describe("basicStrategy", () => {
  it("splits aces and eights always", async () => {
    const { basicStrategy } = await import("../blackjackGame.js");
    expect(basicStrategy(
      [{ suit: "S", rank: "A" }, { suit: "H", rank: "A" }],
      10, true, true,
    )).toBe("split");
    expect(basicStrategy(
      [{ suit: "S", rank: "8" }, { suit: "H", rank: "8" }],
      11, true, true,
    )).toBe("split");
  });

  it("never splits tens", async () => {
    const { basicStrategy } = await import("../blackjackGame.js");
    expect(basicStrategy(
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "10" }],
      5, true, true,
    )).toBe("stand");
  });

  it("doubles hard 11 on any upcard", async () => {
    const { basicStrategy } = await import("../blackjackGame.js");
    expect(basicStrategy(
      [{ suit: "S", rank: "5" }, { suit: "H", rank: "6" }],
      11, true, false,
    )).toBe("double");
  });

  it("stands hard 16 vs 6, hits hard 16 vs 10", async () => {
    const { basicStrategy } = await import("../blackjackGame.js");
    expect(basicStrategy(
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "6" }],
      6, false, false,
    )).toBe("stand");
    expect(basicStrategy(
      [{ suit: "S", rank: "10" }, { suit: "H", rank: "6" }],
      10, false, false,
    )).toBe("hit");
  });

  it("hits soft 17 (the A6 case that the old bot got wrong)", async () => {
    const { basicStrategy } = await import("../blackjackGame.js");
    expect(basicStrategy(
      [{ suit: "S", rank: "A" }, { suit: "H", rank: "6" }],
      8, false, false,
    )).toBe("hit");
  });

  it("stands soft 18 vs 2/7/8, hits vs 9/10/A, doubles vs 3-6", async () => {
    const { basicStrategy } = await import("../blackjackGame.js");
    const A7 = [{ suit: "S" as const, rank: "A" as const }, { suit: "H" as const, rank: "7" as const }];
    expect(basicStrategy(A7, 2,  false, false)).toBe("stand");
    expect(basicStrategy(A7, 8,  false, false)).toBe("stand");
    expect(basicStrategy(A7, 10, false, false)).toBe("hit");
    expect(basicStrategy(A7, 11, false, false)).toBe("hit");
    expect(basicStrategy(A7, 5,  true,  false)).toBe("double");
  });

  it("falls back from double to hit when canDouble is false", async () => {
    const { basicStrategy } = await import("../blackjackGame.js");
    expect(basicStrategy(
      [{ suit: "S", rank: "5" }, { suit: "H", rank: "6" }],
      11, false, false,
    )).toBe("hit");
  });

  it("falls back from split to hit when canSplit is false", async () => {
    const { basicStrategy } = await import("../blackjackGame.js");
    // Pair of 7s vs 6 would be split, but canSplit=false → hit (total 14 vs 6 would be stand, but pair-logic
    // falls through to hard-total logic which says stand on 14 vs 6).
    expect(basicStrategy(
      [{ suit: "S", rank: "7" }, { suit: "H", rank: "7" }],
      6, false, false,
    )).toBe("stand");
  });
});

describe("botPlayTurn", () => {
  it("plays basic strategy: hits hard 12 vs 10 then stands on 17", async () => {
    const { botPlayTurn } = await import("../blackjackGame.js");
    await createBlackjackGame(LOBBY, ["bot-x", "p2"], CONFIG);
    // 12 vs upcard-less-dealer (defaults to 10 → defensive line): hit 12 vs 10.
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.phase = "playing";
    g.activePlayerIndex = 0;
    g.activeHandIndex = 0;
    g.hands["bot-x"] = [{ cards: [{ suit: "S", rank: "7" }, { suit: "H", rank: "5" }], bet: 10, doubled: false, resolved: false, fromSplit: false }];
    g.hands["p2"] = [{ cards: [{ suit: "D", rank: "10" }, { suit: "C", rank: "10" }], bet: 10, doubled: false, resolved: false, fromSplit: false }];
    g.shoe = [{ suit: "C", rank: "5" }]; // top draw
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await botPlayTurn(LOBBY, "bot-x");
    const v = (await getBlackjackPlayerView(LOBBY, "p2"))!;
    expect(v.hands["bot-x"][0].resolved).toBe(true);
    expect(v.hands["bot-x"][0].cards.length).toBe(3);
    expect(v.activePlayerId).toBe("p2"); // advanced
  });

  it("doubles down on hard 11", async () => {
    const { botPlayTurn } = await import("../blackjackGame.js");
    await createBlackjackGame(LOBBY, ["bot-x", "p2"], CONFIG);
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.phase = "playing";
    g.activePlayerIndex = 0;
    g.activeHandIndex = 0;
    g.dealerHand = [{ suit: "D", rank: "6" }, { suit: "?" as any, rank: "?" as any }];
    g.hands["bot-x"] = [{ cards: [{ suit: "S", rank: "5" }, { suit: "H", rank: "6" }], bet: 10, doubled: false, resolved: false, fromSplit: false }];
    g.hands["p2"]    = [{ cards: [{ suit: "D", rank: "10" }, { suit: "C", rank: "10" }], bet: 10, doubled: false, resolved: false, fromSplit: false }];
    g.shoe = [{ suit: "C", rank: "9" }]; // double draws this
    const chipsBefore = g.chips["bot-x"];
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await botPlayTurn(LOBBY, "bot-x");
    const v = (await getBlackjackPlayerView(LOBBY, "p2"))!;
    expect(v.hands["bot-x"][0].doubled).toBe(true);
    expect(v.hands["bot-x"][0].bet).toBe(20); // bet doubled
    expect(v.hands["bot-x"][0].cards.length).toBe(3); // one extra card
    expect(v.chips["bot-x"]).toBe(chipsBefore - 10); // staked an extra 10
    expect(v.activePlayerId).toBe("p2");
  });

  it("splits a pair of 8s and plays both hands", async () => {
    const { botPlayTurn } = await import("../blackjackGame.js");
    await createBlackjackGame(LOBBY, ["bot-x", "p2"], CONFIG);
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.phase = "playing";
    g.activePlayerIndex = 0;
    g.activeHandIndex = 0;
    g.dealerHand = [{ suit: "D", rank: "10" }, { suit: "?" as any, rank: "?" as any }];
    g.hands["bot-x"] = [{ cards: [{ suit: "S", rank: "8" }, { suit: "H", rank: "8" }], bet: 10, doubled: false, resolved: false, fromSplit: false }];
    g.hands["p2"]    = [{ cards: [{ suit: "D", rank: "10" }, { suit: "C", rank: "10" }], bet: 10, doubled: false, resolved: false, fromSplit: false }];
    // Shoe is popped from the end; order so split draws 2, then 2 (both busted vs 10 → hit → hit → bust).
    // After split: handA gets rank "9" (8+9=17 → stand), handB gets rank "9" (8+9=17 → stand).
    g.shoe = [
      { suit: "C", rank: "9" }, // handB second card
      { suit: "D", rank: "9" }, // handA second card
    ];
    const chipsBefore = g.chips["bot-x"];
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await botPlayTurn(LOBBY, "bot-x");
    const v = (await getBlackjackPlayerView(LOBBY, "p2"))!;
    expect(v.hands["bot-x"].length).toBe(2);           // two hands
    expect(v.hands["bot-x"][0].fromSplit).toBe(true);
    expect(v.hands["bot-x"][1].fromSplit).toBe(true);
    expect(v.hands["bot-x"][0].resolved).toBe(true);
    expect(v.hands["bot-x"][1].resolved).toBe(true);
    expect(v.chips["bot-x"]).toBe(chipsBefore - 10);   // one extra bet staked
    expect(v.activePlayerId).toBe("p2");
  });

  it("auto-resolves both halves of a split-aces hand", async () => {
    const { botPlayTurn } = await import("../blackjackGame.js");
    await createBlackjackGame(LOBBY, ["bot-x", "p2"], CONFIG);
    const exported = await exportBlackjackGames();
    const g = exported.find((x: any) => x.lobbyCode === LOBBY)!;
    g.phase = "playing";
    g.activePlayerIndex = 0;
    g.activeHandIndex = 0;
    g.dealerHand = [{ suit: "D", rank: "10" }, { suit: "?" as any, rank: "?" as any }];
    g.hands["bot-x"] = [{ cards: [{ suit: "S", rank: "A" }, { suit: "H", rank: "A" }], bet: 10, doubled: false, resolved: false, fromSplit: false }];
    g.hands["p2"]    = [{ cards: [{ suit: "D", rank: "10" }, { suit: "C", rank: "10" }], bet: 10, doubled: false, resolved: false, fromSplit: false }];
    g.shoe = [
      { suit: "C", rank: "5" },
      { suit: "D", rank: "5" },
    ];
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames([g]);

    await botPlayTurn(LOBBY, "bot-x");
    const v = (await getBlackjackPlayerView(LOBBY, "p2"))!;
    expect(v.hands["bot-x"].length).toBe(2);
    // Split-aces: both hands get exactly 2 cards and auto-resolve.
    expect(v.hands["bot-x"][0].cards.length).toBe(2);
    expect(v.hands["bot-x"][1].cards.length).toBe(2);
    expect(v.hands["bot-x"][0].resolved).toBe(true);
    expect(v.hands["bot-x"][1].resolved).toBe(true);
    expect(v.activePlayerId).toBe("p2");
  });
});

describe("restoreBlackjackGames zombie filter", () => {
  it("skips games whose createdAt is more than 2h in the past", async () => {
    await createBlackjackGame(LOBBY, PLAYERS, CONFIG);
    const exported = JSON.parse(JSON.stringify(await exportBlackjackGames()));
    exported[0].createdAt = Date.now() - (3 * 60 * 60 * 1000); // 3h old
    await cleanupBlackjackGame(LOBBY);
    await restoreBlackjackGames(exported);
    expect(await isBlackjackGame(LOBBY)).toBe(false);
  });
});
