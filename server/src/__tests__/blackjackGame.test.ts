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
