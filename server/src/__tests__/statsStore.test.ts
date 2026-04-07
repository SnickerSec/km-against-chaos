import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../db.js", () => ({
  default: { query: vi.fn() },
}));

import pool from "../db.js";
import { recordGameResult, getUserStats, getLeaderboard } from "../statsStore.js";

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
});

// ── recordGameResult ─────────────────────────────────────────────────────────

describe("recordGameResult", () => {
  it("inserts game and player rows", async () => {
    mockQuery.mockResolvedValue({});

    const gameId = await recordGameResult({
      lobbyCode: "ABCD",
      deckId: "deck-1",
      deckName: "Test Deck",
      gameType: "cah",
      playerCount: 3,
      roundsPlayed: 5,
      players: [
        { userId: "u1", name: "Alice", score: 3, isWinner: true },
        { userId: "u2", name: "Bob", score: 1, isWinner: false },
        { name: "Bot", score: 0, isWinner: false, isBot: true },
      ],
    });

    expect(gameId).toBeTruthy();
    expect(typeof gameId).toBe("string");
    // 1 game_history INSERT + 3 game_players INSERTs
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  it("passes correct game history params", async () => {
    mockQuery.mockResolvedValue({});

    await recordGameResult({
      lobbyCode: "ABCD",
      deckId: "deck-1",
      deckName: "Test Deck",
      gameType: "uno",
      playerCount: 2,
      roundsPlayed: 10,
      players: [],
    });

    const [query, params] = mockQuery.mock.calls[0];
    expect(query).toContain("game_history");
    expect(params[1]).toBe("ABCD");      // lobbyCode
    expect(params[2]).toBe("deck-1");    // deckId
    expect(params[3]).toBe("Test Deck"); // deckName
    expect(params[4]).toBe("uno");       // gameType
    expect(params[5]).toBe(2);           // playerCount
    expect(params[6]).toBe(10);          // roundsPlayed
  });

  it("passes correct player params", async () => {
    mockQuery.mockResolvedValue({});

    await recordGameResult({
      lobbyCode: "ABCD",
      deckId: null,
      deckName: "Deck",
      gameType: "cah",
      playerCount: 1,
      roundsPlayed: 1,
      players: [
        { userId: "u1", name: "Alice", score: 5, isWinner: true, isBot: false },
      ],
    });

    // Second call is the player INSERT
    const [query, params] = mockQuery.mock.calls[1];
    expect(query).toContain("game_players");
    expect(params[2]).toBe("u1");    // userId
    expect(params[3]).toBe("Alice"); // name
    expect(params[4]).toBe(5);       // score
    expect(params[5]).toBe(true);    // isWinner
    expect(params[6]).toBe(false);   // isBot
  });

  it("handles null userId in player", async () => {
    mockQuery.mockResolvedValue({});

    await recordGameResult({
      lobbyCode: "ABCD",
      deckId: null,
      deckName: "Deck",
      gameType: "cah",
      playerCount: 1,
      roundsPlayed: 1,
      players: [
        { userId: null, name: "Guest", score: 0, isWinner: false },
      ],
    });

    const params = mockQuery.mock.calls[1][1];
    expect(params[2]).toBeNull(); // userId
  });

  it("defaults isBot to false when not provided", async () => {
    mockQuery.mockResolvedValue({});

    await recordGameResult({
      lobbyCode: "ABCD",
      deckId: null,
      deckName: "Deck",
      gameType: "cah",
      playerCount: 1,
      roundsPlayed: 1,
      players: [
        { name: "Player", score: 0, isWinner: false },
      ],
    });

    const params = mockQuery.mock.calls[1][1];
    expect(params[6]).toBe(false); // isBot defaults to false
  });
});

// ── getUserStats ─────────────────────────────────────────────────────────────

describe("getUserStats", () => {
  it("returns computed stats from DB rows", async () => {
    // First query: aggregate stats
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_games: "10", wins: "4", total_points: "25", favorite_game_type: "cah" }],
    });
    // Second query: breakdown
    mockQuery.mockResolvedValueOnce({
      rows: [
        { game_type: "cah", games: "7", wins: "3" },
        { game_type: "uno", games: "3", wins: "1" },
      ],
    });
    // Third query: recent games
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: "g1", deck_name: "Deck A", game_type: "cah", ended_at: "2025-01-01", player_count: 4, final_score: 3, is_winner: true },
      ],
    });

    const stats = await getUserStats("u1");

    expect(stats.totalGames).toBe(10);
    expect(stats.wins).toBe(4);
    expect(stats.winRate).toBe(40);
    expect(stats.totalPoints).toBe(25);
    expect(stats.favoriteGameType).toBe("cah");
    expect(stats.breakdown).toHaveLength(2);
    expect(stats.breakdown[0]).toEqual({ gameType: "cah", games: 7, wins: 3 });
    expect(stats.recentGames).toHaveLength(1);
    expect(stats.recentGames[0].deckName).toBe("Deck A");
    expect(stats.recentGames[0].isWinner).toBe(true);
  });

  it("handles zero games", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_games: "0", wins: "0", total_points: "0", favorite_game_type: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const stats = await getUserStats("u1");

    expect(stats.totalGames).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.totalPoints).toBe(0);
    expect(stats.favoriteGameType).toBeNull();
    expect(stats.breakdown).toEqual([]);
    expect(stats.recentGames).toEqual([]);
  });

  it("handles null/NaN values gracefully", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_games: null, wins: null, total_points: null, favorite_game_type: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const stats = await getUserStats("u1");
    expect(stats.totalGames).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.totalPoints).toBe(0);
  });

  it("passes userId to all three queries", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total_games: "0", wins: "0", total_points: "0", favorite_game_type: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getUserStats("user-42");

    expect(mockQuery.mock.calls[0][1]).toEqual(["user-42"]);
    expect(mockQuery.mock.calls[1][1]).toEqual(["user-42"]);
    expect(mockQuery.mock.calls[2][1]).toEqual(["user-42"]);
  });
});

// ── getLeaderboard ───────────────────────────────────────────────────────────

describe("getLeaderboard", () => {
  it("returns leaderboard entries with computed winRate", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { name: "Alice", picture: "pic1.jpg", user_id: "u1", total_games: "10", wins: "7" },
        { name: "Bob", picture: null, user_id: "u2", total_games: "8", wins: "2" },
      ],
    });

    const board = await getLeaderboard();

    expect(board).toHaveLength(2);
    expect(board[0].name).toBe("Alice");
    expect(board[0].totalGames).toBe(10);
    expect(board[0].wins).toBe(7);
    expect(board[0].winRate).toBe(70);
    expect(board[1].winRate).toBe(25);
  });

  it("filters by gameType when provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getLeaderboard("uno");

    const [query, params] = mockQuery.mock.calls[0];
    expect(query).toContain("game_type");
    expect(params).toEqual(["uno"]);
  });

  it("no gameType filter when not provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getLeaderboard();

    const params = mockQuery.mock.calls[0][1];
    expect(params).toEqual([]);
  });

  it("returns empty array when no players", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const board = await getLeaderboard();
    expect(board).toEqual([]);
  });
});
