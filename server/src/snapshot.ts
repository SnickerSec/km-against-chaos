import type { Server } from "socket.io";
import pool from "./db.js";
import { createLogger } from "./logger.js";
import { exportLobbies, restoreLobbies } from "./lobby.js";
import { exportGames, restoreGames } from "./game.js";
import { exportUnoGames, restoreUnoGames } from "./unoGame.js";
import { exportCodenamesGames, restoreCodenamesGames } from "./codenamesGame.js";
import { exportBlackjackGames, restoreBlackjackGames } from "./blackjackGame.js";
import {
  exportChatHistory,
  restoreChatHistory,
  scheduleRoundTimer,
  scheduleUnoTurnTimer,
  scheduleBlackjackTimer,
} from "./socketHelpers.js";
import { createCahTimerCallback } from "./handlers/cahHandlers.js";
import { createUnoTimerCallback } from "./handlers/unoHandlers.js";
import { createBlackjackTimerCallback, triggerBlackjackBots } from "./handlers/blackjackHandlers.js";
import type { ClientEvents, ServerEvents } from "./types.js";

const log = createLogger("snapshot");

// Snapshots older than this are ignored on startup — a stale snapshot from
// a crash hours ago should not revive dead lobbies.
const MAX_SNAPSHOT_AGE_MINUTES = 15;

const SNAPSHOT_TABLES =
  "lobby_snapshots, cah_game_snapshots, uno_game_snapshots, codenames_game_snapshots, blackjack_game_snapshots, chat_snapshots";

export async function snapshotAll(): Promise<void> {
  const lobbies = await exportLobbies();
  const cahGames = (await exportGames()).filter((g: any) => g.gameType === "cah");
  const unoGames = await exportUnoGames();
  const codenamesGames = await exportCodenamesGames();
  const blackjackGames = await exportBlackjackGames();
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
    for (const g of blackjackGames) {
      await client.query(
        "INSERT INTO blackjack_game_snapshots (lobby_code, state) VALUES ($1, $2)",
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
      blackjackGames: blackjackGames.length,
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
    // Rolling-deploy safety: if Redis already has lobbies, the other replica
    // has been serving and advancing shared state while we were down. Our
    // snapshot is now stale — restoring it would clobber fresher state
    // (revert round progress, flip connected players to disconnected, etc.
    // — the "deploy interrupted our game" symptom). Skip the data restore;
    // Redis is authoritative. Cold-start (Redis wiped) still restores.
    const liveLobbies = await exportLobbies();
    const redisHasLiveState = liveLobbies.length > 0;

    if (redisHasLiveState) {
      log.info("skipping snapshot restore — Redis has live state", {
        lobbies: liveLobbies.length,
      });
      // Do NOT truncate the snapshot tables — if both replicas later die
      // hard (e.g. Redis outage + crash), the last snapshot is the only
      // way back. Each graceful SIGTERM rewrites the table anyway.
    } else {
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
      const blackjackGames = await pool.query(
        `SELECT state FROM blackjack_game_snapshots WHERE created_at > ${cutoff}`
      );
      const chats = await pool.query(
        `SELECT code, messages FROM chat_snapshots WHERE created_at > ${cutoff}`
      );

      await restoreLobbies(lobbies.rows.map(r => r.state));
      await restoreGames(cahGames.rows.map(r => r.state));
      await restoreUnoGames(unoGames.rows.map(r => r.state));
      await restoreCodenamesGames(codenamesGames.rows.map(r => r.state));
      await restoreBlackjackGames(blackjackGames.rows.map(r => r.state));
      await restoreChatHistory(chats.rows.map(r => ({ code: r.code, messages: r.messages })));

      // Snapshots are one-shot after a real restore — clear so a later
      // crash cannot revive long-dead state.
      await pool.query(`TRUNCATE ${SNAPSHOT_TABLES}`);

      log.info("snapshot restored", {
        lobbies: lobbies.rowCount,
        cahGames: cahGames.rowCount,
        unoGames: unoGames.rowCount,
        codenamesGames: codenamesGames.rowCount,
        blackjackGames: blackjackGames.rowCount,
        chats: chats.rowCount,
      });
    }

    // Either path: re-arm phase timers for whatever games are live in
    // Redis right now. A timer is in-memory per replica, so a freshly-
    // booted replica needs to arm its own — the cross-replica Redis lock
    // (claimTimerLock) guarantees at-most-once if another replica also
    // armed one. Iterating Redis (not the snapshot) means we honour live
    // state, not the snapshot's stale view.
    await rearmLiveTimers(io);
  } catch (err) {
    log.error("restore failed", { error: String(err) });
  }
}

async function rearmLiveTimers(io: Server<ClientEvents, ServerEvents>): Promise<void> {
  let rearmedCah = 0;
  let rearmedUno = 0;
  let rearmedBlackjack = 0;

  const cahCallback = createCahTimerCallback(io);
  for (const g of await exportGames()) {
    if (g.gameType === "cah" && g.currentRound && !g.gameOver) {
      scheduleRoundTimer(g.lobbyCode, cahCallback);
      rearmedCah++;
    }
  }
  const unoCallback = createUnoTimerCallback(io);
  for (const g of await exportUnoGames()) {
    if (g.phase === "playing" && !g.gameOver) {
      scheduleUnoTurnTimer(g.lobbyCode, unoCallback);
      rearmedUno++;
    }
  }
  const blackjackCallback = createBlackjackTimerCallback(io);
  for (const g of await exportBlackjackGames()) {
    if (g.phase && g.phase !== "gameOver") {
      await scheduleBlackjackTimer(g.lobbyCode, blackjackCallback);
      // Blackjack bots are driven by a proactive trigger (setTimeout after each
      // state mutation), not by the phase timer. On restore we lose those
      // pending timeouts, so without this kick, a game paused on a bot's turn
      // would stall until the phase deadline fired (up to 30s) — bots only
      // auto-stand via the timeout, not via strategy.
      await triggerBlackjackBots(io, g.lobbyCode);
      rearmedBlackjack++;
    }
  }

  log.info("re-armed live timers", { rearmedCah, rearmedUno, rearmedBlackjack });
}
