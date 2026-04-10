import pool from "./db.js";
import { randomBytes } from "crypto";

function genId(): string {
  return randomBytes(8).toString("hex");
}

export interface GameResult {
  lobbyCode: string;
  deckId: string | null;
  deckName: string;
  gameType: string;
  playerCount: number;
  roundsPlayed: number;
  players: {
    userId?: string | null;
    name: string;
    score: number;
    isWinner: boolean;
    isBot?: boolean;
  }[];
}

export async function recordGameResult(result: GameResult): Promise<string> {
  const gameId = genId();

  await pool.query(
    `INSERT INTO game_history (id, lobby_code, deck_id, deck_name, game_type, player_count, rounds_played)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [gameId, result.lobbyCode, result.deckId, result.deckName, result.gameType, result.playerCount, result.roundsPlayed]
  );

  for (const p of result.players) {
    await pool.query(
      `INSERT INTO game_players (id, game_id, user_id, player_name, final_score, is_winner, is_bot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [genId(), gameId, p.userId || null, p.name, p.score, p.isWinner, p.isBot || false]
    );
  }

  return gameId;
}

export async function getUserStats(userId: string) {
  const result = await pool.query(`
    SELECT
      COUNT(DISTINCT gp.game_id) as total_games,
      COUNT(DISTINCT CASE WHEN gp.is_winner THEN gp.game_id END) as wins,
      COALESCE(SUM(gp.final_score), 0) as total_points,
      (SELECT gh.game_type FROM game_players gp2
       JOIN game_history gh ON gh.id = gp2.game_id
       WHERE gp2.user_id = $1
       GROUP BY gh.game_type
       ORDER BY COUNT(*) DESC LIMIT 1) as favorite_game_type
    FROM game_players gp
    WHERE gp.user_id = $1 AND gp.is_bot = FALSE
  `, [userId]);

  const row = result.rows[0];
  const totalGames = parseInt(row.total_games) || 0;
  const wins = parseInt(row.wins) || 0;

  // Per game type breakdown
  const breakdown = await pool.query(`
    SELECT gh.game_type,
           COUNT(*) as games,
           COUNT(CASE WHEN gp.is_winner THEN 1 END) as wins
    FROM game_players gp
    JOIN game_history gh ON gh.id = gp.game_id
    WHERE gp.user_id = $1 AND gp.is_bot = FALSE
    GROUP BY gh.game_type
    ORDER BY games DESC
  `, [userId]);

  // Recent games
  const recent = await pool.query(`
    SELECT gh.id, gh.deck_name, gh.game_type, gh.ended_at, gh.player_count,
           gp.final_score, gp.is_winner
    FROM game_players gp
    JOIN game_history gh ON gh.id = gp.game_id
    WHERE gp.user_id = $1 AND gp.is_bot = FALSE
    ORDER BY gh.ended_at DESC
    LIMIT 10
  `, [userId]);

  return {
    totalGames,
    wins,
    winRate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
    totalPoints: parseInt(row.total_points) || 0,
    favoriteGameType: row.favorite_game_type || null,
    breakdown: breakdown.rows.map(r => ({
      gameType: r.game_type,
      games: parseInt(r.games),
      wins: parseInt(r.wins),
    })),
    recentGames: recent.rows.map(r => ({
      id: r.id,
      deckName: r.deck_name,
      gameType: r.game_type,
      endedAt: r.ended_at,
      playerCount: r.player_count,
      finalScore: r.final_score,
      isWinner: r.is_winner,
    })),
  };
}

export async function getGameHistory(userId: string, page = 1, limit = 20) {
  const offset = (page - 1) * limit;

  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM game_players gp WHERE gp.user_id = $1 AND gp.is_bot = FALSE`,
    [userId]
  );
  const total = parseInt(countResult.rows[0].total) || 0;

  const result = await pool.query(`
    SELECT gh.id, gh.deck_name, gh.game_type, gh.ended_at, gh.player_count,
           gp.final_score, gp.is_winner
    FROM game_players gp
    JOIN game_history gh ON gh.id = gp.game_id
    WHERE gp.user_id = $1 AND gp.is_bot = FALSE
    ORDER BY gh.ended_at DESC
    LIMIT $2 OFFSET $3
  `, [userId, limit, offset]);

  return {
    results: result.rows.map(r => ({
      id: r.id,
      deckName: r.deck_name,
      gameType: r.game_type,
      endedAt: r.ended_at,
      playerCount: r.player_count,
      finalScore: r.final_score,
      isWinner: r.is_winner,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

export async function getLeaderboard(gameType?: string) {
  const whereClause = gameType ? `AND gh.game_type = $1` : '';
  const params = gameType ? [gameType] : [];

  const result = await pool.query(`
    SELECT u.name, u.picture, gp.user_id,
           COUNT(DISTINCT gp.game_id) as total_games,
           COUNT(DISTINCT CASE WHEN gp.is_winner THEN gp.game_id END) as wins
    FROM game_players gp
    JOIN users u ON u.id = gp.user_id
    JOIN game_history gh ON gh.id = gp.game_id
    WHERE gp.user_id IS NOT NULL AND gp.is_bot = FALSE ${whereClause}
    GROUP BY u.name, u.picture, gp.user_id
    HAVING COUNT(DISTINCT gp.game_id) >= 1
    ORDER BY wins DESC, total_games ASC
    LIMIT 20
  `, params);

  return result.rows.map(r => ({
    name: r.name,
    picture: r.picture,
    userId: r.user_id,
    totalGames: parseInt(r.total_games),
    wins: parseInt(r.wins),
    winRate: Math.round((parseInt(r.wins) / parseInt(r.total_games)) * 100),
  }));
}
