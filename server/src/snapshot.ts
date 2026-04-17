import type { Server } from "socket.io";
import pool from "./db.js";
import { createLogger } from "./logger.js";
import { exportLobbies, restoreLobbies } from "./lobby.js";
import { exportGames, restoreGames } from "./game.js";
import { exportUnoGames, restoreUnoGames } from "./unoGame.js";
import { exportCodenamesGames, restoreCodenamesGames } from "./codenamesGame.js";
import {
  exportChatHistory,
  restoreChatHistory,
  scheduleRoundTimer,
  scheduleUnoTurnTimer,
} from "./socketHelpers.js";
import { createCahTimerCallback } from "./handlers/cahHandlers.js";
import { createUnoTimerCallback } from "./handlers/unoHandlers.js";
import type { ClientEvents, ServerEvents } from "./types.js";

const log = createLogger("snapshot");

// Snapshots older than this are ignored on startup — a stale snapshot from
// a crash hours ago should not revive dead lobbies.
const MAX_SNAPSHOT_AGE_MINUTES = 15;

const SNAPSHOT_TABLES =
  "lobby_snapshots, cah_game_snapshots, uno_game_snapshots, codenames_game_snapshots, chat_snapshots";

export async function snapshotAll(): Promise<void> {
  const lobbies = await exportLobbies();
  const cahGames = exportGames().filter(g => g.gameType === "cah");
  const unoGames = await exportUnoGames();
  const codenamesGames = await exportCodenamesGames();
  const allChats = await exportChatHistory();
  const chats = allChats.filter(c => lobbies.some((l: any) => l.code === c.code));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`TRUNCATE ${SNAPSHOT_TABLES}`);
    for (const l of lobbies) {
      await client.query(
        "INSERT INTO lobby_snapshots (code, state) VALUES ($1, $2)",
        [l.code, JSON.stringify(l)]
      );
    }
    for (const g of cahGames) {
      await client.query(
        "INSERT INTO cah_game_snapshots (lobby_code, state) VALUES ($1, $2)",
        [g.lobbyCode, JSON.stringify(g)]
      );
    }
    for (const g of unoGames) {
      await client.query(
        "INSERT INTO uno_game_snapshots (lobby_code, state) VALUES ($1, $2)",
        [g.lobbyCode, JSON.stringify(g)]
      );
    }
    for (const g of codenamesGames) {
      await client.query(
        "INSERT INTO codenames_game_snapshots (lobby_code, state) VALUES ($1, $2)",
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
      lobbies: lobbies.length,
      cahGames: cahGames.length,
      unoGames: unoGames.length,
      codenamesGames: codenamesGames.length,
      chats: chats.length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    log.error("snapshot failed", { error: String(err) });
  } finally {
    client.release();
  }
}

export async function restoreAll(
  io: Server<ClientEvents, ServerEvents>
): Promise<void> {
  try {
    const cutoff = `NOW() - INTERVAL '${MAX_SNAPSHOT_AGE_MINUTES} minutes'`;
    const lobbies = await pool.query(
      `SELECT state FROM lobby_snapshots WHERE created_at > ${cutoff}`
    );
    const cahGames = await pool.query(
      `SELECT state FROM cah_game_snapshots WHERE created_at > ${cutoff}`
    );
    const unoGames = await pool.query(
      `SELECT state FROM uno_game_snapshots WHERE created_at > ${cutoff}`
    );
    const codenamesGames = await pool.query(
      `SELECT state FROM codenames_game_snapshots WHERE created_at > ${cutoff}`
    );
    const chats = await pool.query(
      `SELECT code, messages FROM chat_snapshots WHERE created_at > ${cutoff}`
    );

    await restoreLobbies(lobbies.rows.map(r => r.state));
    restoreGames(cahGames.rows.map(r => r.state));
    await restoreUnoGames(unoGames.rows.map(r => r.state));
    await restoreCodenamesGames(codenamesGames.rows.map(r => r.state));
    await restoreChatHistory(chats.rows.map(r => ({ code: r.code, messages: r.messages })));

    // Snapshots are one-shot — clear after restoring so a later crash
    // cannot revive long-dead state.
    await pool.query(`TRUNCATE ${SNAPSHOT_TABLES}`);

    // Re-arm phase timers for games that were mid-play when the server went
    // down. Without this, the restored deadline is only advisory — the server
    // would never auto-advance on idle players, leaving the game stuck.
    let rearmedCah = 0;
    let rearmedUno = 0;
    const cahCallback = createCahTimerCallback(io);
    for (const row of cahGames.rows) {
      const state = row.state;
      if (state?.currentRound && !state.gameOver) {
        scheduleRoundTimer(state.lobbyCode, cahCallback);
        rearmedCah++;
      }
    }
    const unoCallback = createUnoTimerCallback(io);
    for (const row of unoGames.rows) {
      const state = row.state;
      if (state?.phase === "playing" && !state.gameOver) {
        scheduleUnoTurnTimer(state.lobbyCode, unoCallback);
        rearmedUno++;
      }
    }

    log.info("snapshot restored", {
      lobbies: lobbies.rowCount,
      cahGames: cahGames.rowCount,
      unoGames: unoGames.rowCount,
      codenamesGames: codenamesGames.rowCount,
      chats: chats.rowCount,
      rearmedCah,
      rearmedUno,
    });
  } catch (err) {
    log.error("restore failed", { error: String(err) });
  }
}
