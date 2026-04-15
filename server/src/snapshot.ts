import pool from "./db.js";
import { createLogger } from "./logger.js";
import { exportLobbies, restoreLobbies } from "./lobby.js";
import { exportGames, restoreGames } from "./game.js";
import { exportChatHistory, restoreChatHistory } from "./socketHelpers.js";

const log = createLogger("snapshot");

// Snapshots older than this are ignored on startup — a stale snapshot from
// a crash hours ago should not revive dead lobbies.
const MAX_SNAPSHOT_AGE_MINUTES = 15;

export async function snapshotAll(): Promise<void> {
  const lobbies = exportLobbies();
  // Scope: only snapshot CAH-playable lobbies. Uno/Codenames playing-state
  // is not persisted yet, so dropping those lobbies is the honest outcome.
  const keepLobbies = lobbies.filter(l => l.gameType === "cah" || l.status === "waiting");
  const games = exportGames().filter(g => g.gameType === "cah");
  const chats = exportChatHistory().filter(c =>
    keepLobbies.some(l => l.code === c.code)
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE lobby_snapshots, cah_game_snapshots, chat_snapshots");
    for (const l of keepLobbies) {
      await client.query(
        "INSERT INTO lobby_snapshots (code, state) VALUES ($1, $2)",
        [l.code, JSON.stringify(l)]
      );
    }
    for (const g of games) {
      await client.query(
        "INSERT INTO cah_game_snapshots (lobby_code, state) VALUES ($1, $2)",
        [g.lobbyCode, JSON.stringify(g)]
      );
    }
    for (const c of chats) {
      await client.query(
        "INSERT INTO chat_snapshots (code, messages) VALUES ($1, $2)",
        [c.code, JSON.stringify(c.messages)]
      );
    }
    await client.query("COMMIT");
    log.info("snapshot written", {
      lobbies: keepLobbies.length,
      games: games.length,
      chats: chats.length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    log.error("snapshot failed", { error: String(err) });
  } finally {
    client.release();
  }
}

export async function restoreAll(): Promise<void> {
  try {
    const cutoff = `NOW() - INTERVAL '${MAX_SNAPSHOT_AGE_MINUTES} minutes'`;
    const lobbies = await pool.query(
      `SELECT state FROM lobby_snapshots WHERE created_at > ${cutoff}`
    );
    const games = await pool.query(
      `SELECT state FROM cah_game_snapshots WHERE created_at > ${cutoff}`
    );
    const chats = await pool.query(
      `SELECT code, messages FROM chat_snapshots WHERE created_at > ${cutoff}`
    );

    restoreLobbies(lobbies.rows.map(r => r.state));
    restoreGames(games.rows.map(r => r.state));
    restoreChatHistory(chats.rows.map(r => ({ code: r.code, messages: r.messages })));

    // Snapshots are one-shot — clear after restoring so a later crash
    // cannot revive long-dead state.
    await pool.query("TRUNCATE lobby_snapshots, cah_game_snapshots, chat_snapshots");

    log.info("snapshot restored", {
      lobbies: lobbies.rowCount,
      games: games.rowCount,
      chats: chats.rowCount,
    });
  } catch (err) {
    log.error("restore failed", { error: String(err) });
  }
}
