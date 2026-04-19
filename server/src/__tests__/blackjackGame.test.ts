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
