import { Sentry } from "./instrumentation.js";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { join, resolve, normalize } from "path";
import { existsSync } from "fs";
import type { ClientEvents, ServerEvents } from "./types.js";
import { remapPlayer, disconnectPlayer, getLobbyForSocket } from "./lobby.js";
import deckRoutes from "./deckRoutes.js";
import authRoutes from "./authRoutes.js";
import adminRoutes from "./adminRoutes.js";
import packRoutes from "./packRoutes.js";
import mediaRoutes from "./mediaRoutes.js";
import tgcRoutes from "./tgcRoutes.js";
import statsRoutes from "./statsRoutes.js";
import friendRoutes from "./friendRoutes.js";
import stripeRoutes from "./stripeRoutes.js";
import soundRoutes from "./soundRoutes.js";
import artLibraryRoutes from "./artLibraryRoutes.js";
import cardLibraryRoutes from "./cardLibraryRoutes.js";
import ttsRoutes from "./ttsRoutes.js";
import { setIO as setNotificationIO } from "./notifications.js";
import { setOffline, getUserIdForSocket, getSocketIdsForUser, remapSocket as remapPresenceSocket } from "./presence.js";
import { remapPartySocket } from "./party.js";
import { seedBuiltInDecks } from "./deckStore.js";
import pool, { initDb } from "./db.js";
import { getPlayerView } from "./game.js";
import { isUnoGame, remapUnoGamePlayer, getUnoPlayerView } from "./unoGame.js";
import { remapGamePlayer } from "./game.js";
import { isCodenamesGame, getCodenamesPlayerView } from "./codenamesGame.js";
import { isBlackjackGame, remapBlackjackPlayer, getBlackjackPlayerView } from "./blackjackGame.js";
import { registerSession, getSessionId, cancelDisconnectTimer } from "./sessions.js";
import { removeFromVoice, getChatHistory, sendRoundToPlayers } from "./socketHelpers.js";
import { createLogger } from "./logger.js";
import { snapshotAll, restoreAll } from "./snapshot.js";
import { registerLobbyHandlers, handleLeave } from "./handlers/lobbyHandlers.js";

const log = createLogger("server");
import { registerCahHandlers } from "./handlers/cahHandlers.js";
import { registerUnoHandlers } from "./handlers/unoHandlers.js";
import { registerCodenamesHandlers } from "./handlers/codenamesHandlers.js";
import { registerBlackjackHandlers } from "./handlers/blackjackHandlers.js";
import { registerSocialHandlers } from "./handlers/socialHandlers.js";

// ── Express Setup ────────────────────────────────────────────────────────────

const app = express();
app.set("trust proxy", 1);
app.use(helmet({
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://accounts.google.com https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://accounts.google.com",
      "img-src 'self' data: https:",
      "connect-src 'self' wss: https:",
      "frame-src https://accounts.google.com",
      "media-src 'self' https://www.myinstants.com https://cdn.decked.gg",
    ].join("; ")
  );
  next();
});

// ── HTTP Server + Socket.IO ──────────────────────────────────────────────────

const httpServer = createServer(app);
const io = new Server<ClientEvents, ServerEvents>(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
  pingInterval: 10_000,
  pingTimeout: 5_000,
});

// Cross-replica Socket.IO broadcasting. When REDIS_URL is set, attach the
// Redis adapter so io.to(room).emit(...) fans out to clients connected to
// other replicas. Without REDIS_URL we stay on the in-memory adapter —
// fine for single-replica deploys (current prod), lets us ship the code
// before provisioning Redis.
if (process.env.REDIS_URL) {
  // Lazy-require so tests and envs without the env var don't need the
  // packages loaded.
  (async () => {
    try {
      const { Redis } = await import("ioredis");
      const { createAdapter } = await import("@socket.io/redis-adapter");
      const pub = new Redis(process.env.REDIS_URL!);
      const sub = pub.duplicate();
      io.adapter(createAdapter(pub, sub));
      log.info("socket.io redis adapter attached");
    } catch (err) {
      log.error("failed to attach redis adapter — falling back to in-memory", { error: String(err) });
    }
  })();
}

setNotificationIO(io);

// ── Rate Limiters ────────────────────────────────────────────────────────────

const healthLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests, please try again later" } });
const authLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many auth attempts, please try again later" } });
const staticLimiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests, please try again later" } });

// ── Health Endpoint ──────────────────────────────────────────────────────────

app.get("/health", healthLimiter, async (_req, res) => {
  const checks: Record<string, string> = {};
  let healthy = true;
  if (process.env.DATABASE_URL) {
    try { await pool.query("SELECT 1"); checks.database = "ok"; }
    catch { checks.database = "unreachable"; healthy = false; }
  } else {
    checks.database = "not configured";
  }
  checks.uptime = `${Math.floor(process.uptime())}s`;
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
});

// ── Route Mounting ───────────────────────────────────────────────────────────

app.use("/api/stripe/webhook", (req: any, _res, next) => {
  let chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => { req.rawBody = Buffer.concat(chunks); next(); });
});

// /uploads static mount removed — all persistent URLs now live on R2
// (cdn.decked.gg). See storage.ts for the R2 integration. The Railway
// persistent volume is scheduled for detachment so numReplicas > 1 can
// stick; storage.ts's local-disk fallback only kicks in when R2_* env
// vars are unset, which is tests and dev.

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/admin", apiLimiter, adminRoutes);
app.use("/api/decks", apiLimiter, deckRoutes);
app.use("/api/packs", apiLimiter, packRoutes);
app.use("/api/gifs", staticLimiter, mediaRoutes);
app.use("/api/print/tgc", apiLimiter, tgcRoutes);
app.use("/api/sounds", apiLimiter, soundRoutes);
app.use("/api/art-library", apiLimiter, artLibraryRoutes);
app.use("/api/card-library", apiLimiter, cardLibraryRoutes);
app.use("/api/tts", apiLimiter, ttsRoutes);
app.use(apiLimiter, statsRoutes);
app.use(apiLimiter, friendRoutes);
app.use(apiLimiter, stripeRoutes);

// ── Static File Serving ──────────────────────────────────────────────────────

const possibleClientDirs = [
  join(process.cwd(), "client", "out"),
  join(process.cwd(), "..", "client", "out"),
];
const clientDir = possibleClientDirs.find(d => existsSync(d)) || "";
if (clientDir) {
  app.use(express.static(clientDir, {
    setHeaders: (res, path) => {
      if (path.endsWith(".html")) res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    },
  }));
  app.get("*", staticLimiter, (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health" || req.path.startsWith("/socket.io")) return next();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    const cleanPath = req.path.length > 1 && req.path.endsWith("/") ? req.path.slice(0, -1) : req.path;
    const safePath = normalize(cleanPath).replace(/^(\.\.[\/\\])+/, "");
    const resolvedBase = resolve(clientDir);
    const htmlFile = resolve(clientDir, "." + safePath + ".html");
    if (htmlFile.startsWith(resolvedBase) && existsSync(htmlFile)) return res.sendFile(htmlFile);
    const indexFile = resolve(clientDir, "." + safePath, "index.html");
    if (indexFile.startsWith(resolvedBase) && existsSync(indexFile)) return res.sendFile(indexFile);
    res.sendFile(join(clientDir, "index.html"));
  });
}

// ── Socket.IO Connection Handler ─────────────────────────────────────────────

io.on("connection", async (socket) => {
  // Per-event Sentry isolation: every socket event runs in its own isolation
  // scope so socket.data.user (set by auth:identify) attaches to errors raised
  // inside that event without leaking onto other concurrent sockets' events.
  socket.use((_packet, next) => {
    Sentry.withIsolationScope(() => {
      const u = (socket.data as { user?: { id: string; email: string; username: string } }).user;
      if (u) Sentry.setUser(u);
      next();
    });
  });

  const sessionId: string = socket.handshake.auth?.sessionId || socket.id;
  const { isReconnect, oldSocketId } = await registerSession(sessionId, socket.id);

  if (isReconnect && oldSocketId) {
    cancelDisconnectTimer(sessionId);
    await remapPresenceSocket(oldSocketId, socket.id);

    const lobbyResult = await remapPlayer(oldSocketId, socket.id);
    if (lobbyResult) {
      const { code, lobby } = lobbyResult;
      socket.join(code);

      const uno = await isUnoGame(code);
      const blackjack = await isBlackjackGame(code);
      if (uno) await remapUnoGamePlayer(code, oldSocketId, socket.id);
      else if (blackjack) await remapBlackjackPlayer(code, oldSocketId, socket.id);
      else await remapGamePlayer(code, oldSocketId, socket.id);

      const gameView = lobby.status === "playing" && !uno && !blackjack
        ? await getPlayerView(code, socket.id)
        : null;

      socket.emit("session:reconnected", {
        lobby,
        gameView,
        chatHistory: await getChatHistory(code),
        screen: lobby.status === "playing" ? "game" : "lobby",
      });

      if (uno && lobby.status === "playing") {
        const unoView = await getUnoPlayerView(code, socket.id);
        if (unoView) socket.emit("uno:turn-update", unoView);
      }
      if (blackjack && lobby.status === "playing") {
        const bjView = await getBlackjackPlayerView(code, socket.id);
        if (bjView) socket.emit("blackjack:update" as any, bjView);
      }
      if ((await isCodenamesGame(code)) && lobby.status === "playing") {
        const cnView = await getCodenamesPlayerView(code, socket.id);
        if (cnView) socket.emit("codenames:update" as any, cnView);
      }

      // Re-broadcast the round view to everyone in the CAH/JH/A2A room so
      // other already-connected players see the reconnected player's new
      // socket id (critical when the reconnecting player is the czar —
      // otherwise the others' lobby.players.find(p.id===czarId) returns
      // undefined and the czar renders as "???").
      if (!uno && !blackjack && lobby.status === "playing") {
        await sendRoundToPlayers(io, code);
      }

      socket.to(code).emit("lobby:player-reconnected", socket.id);
      io.to(code).emit("lobby:updated", lobby);
      log.info("player reconnected", { socketId: socket.id, sessionId });
    } else {
      log.info("player connected", { socketId: socket.id });
    }
  } else {
    log.info("player connected", { socketId: socket.id });
  }

  // Register all handler groups
  registerSocialHandlers(io, socket);
  registerLobbyHandlers(io, socket);
  registerCahHandlers(io, socket);
  registerUnoHandlers(io, socket);
  registerCodenamesHandlers(io, socket);
  registerBlackjackHandlers(io, socket);

  // ── Disconnect ──
  socket.on("disconnect", async () => {
    removeFromVoice(io, socket.id);

    const userId = await getUserIdForSocket(socket.id);
    if (userId) {
      const fullyOffline = await setOffline(userId, socket.id);
      if (fullyOffline) {
        try {
          const friends = await pool.query(
            `SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END as friend_id
             FROM friendships f WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'`,
            [userId]
          );
          for (const row of friends.rows) {
            const friendSockets = await getSocketIdsForUser(row.friend_id);
            for (const sid of friendSockets) io.to(sid).emit("friend:offline" as any, { userId });
          }
        } catch {}
      }
    }

    const result = await disconnectPlayer(socket.id);
    if (result) {
      io.to(result.code).emit("lobby:updated", result.lobby);
      io.to(result.code).emit("lobby:player-disconnecting", socket.id);
      log.info("player disconnected, kept in lobby", { socketId: socket.id });
    } else {
      log.info("player disconnected", { socketId: socket.id });
    }
  });
});

// ── Server Start + Graceful Shutdown ─────────────────────────────────────────

const PORT = process.env.PORT || 3001;

async function start() {
  if (process.env.DATABASE_URL) {
    try {
      await initDb();
      await seedBuiltInDecks();
      await restoreAll(io);
    } catch (err) {
      log.error("database init failed, continuing without DB", { error: String(err) });
    }
  } else {
    log.warn("no DATABASE_URL set, database features disabled");
  }
  httpServer.listen(PORT, () => log.info("server started", { port: PORT }));
}

let shuttingDown = false;
function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("graceful shutdown started", { signal });

  // Fail health checks so Railway/load balancers stop routing NEW traffic
  // here. Existing connections keep working.
  app.get("/health", (_req, res) => res.status(503).json({ status: "shutting_down" }));

  // Snapshot active lobbies/games to Postgres so the new container can pick
  // them up. Fire-and-forget; the drain timeout below provides the deadline.
  snapshotAll().catch(err => log.error("snapshot error", { error: String(err) }));

  // IMPORTANT: we do *not* call httpServer.close() here. Closing the HTTP
  // server immediately on SIGTERM stops accepting new connections, but the
  // new Railway container typically takes ~10–15s to come up and pass its
  // health check — during that gap the load balancer has no upstream and
  // returns 502 to every client retry. Keeping the HTTP server open lets
  // old keep serving existing clients (and any Railway-routed traffic)
  // until we actually exit. Railway's health-check failure is enough to
  // steer new traffic to the new container once it's ready.

  // Give in-flight socket events and HTTP requests time to finish. The new
  // container should be up well before this elapses.
  const DRAIN_MS = 25_000;
  setTimeout(async () => {
    try {
      // Last-moment heads-up to connected clients, emitted just before the
      // socket drops. Clients arm a 2s grace timer; Socket.IO's reconnect
      // (now 250ms first retry) normally wins that race → no banner shown.
      io.emit("server_restart", { message: "Server is restarting — you will be reconnected shortly." });
      await new Promise(r => setTimeout(r, 200));
      io.disconnectSockets(true);
      httpServer.close();
      await pool.end();
      log.info("database pool closed");
    } catch (err) {
      log.error("shutdown error", { error: String(err) });
    }
    process.exit(0);
  }, DRAIN_MS);

  // Hard cap — Railway's default SIGKILL is ~3 min, stay well under it.
  setTimeout(() => { log.error("shutdown timed out, forcing exit"); process.exit(1); }, DRAIN_MS + 10_000).unref();
}

// Shutdown sequence at a glance (see gracefulShutdown above for details):
//   SIGTERM → /health → 503, snapshot, *HTTP stays open*
//   …25s drain…
//   emit server_restart → disconnect sockets → close HTTP → pool.end → exit

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Express error handler — must be registered after all routes so it catches
// anything the route handlers throw or forward via next(err).
Sentry.setupExpressErrorHandler(app);

// Socket.IO error capture — handler-thrown errors don't bubble to Express.
// Skip benign engine.io codes that fire during normal client reconnects
// (e.g. after a server restart, polling→websocket upgrade races a stale sid).
// Codes: 1 UNKNOWN_SID, 3 BAD_REQUEST (includes TRANSPORT_MISMATCH).
const BENIGN_ENGINE_IO_CODES = new Set([1, 3]);
io.engine.on("connection_error", (err: any) => {
  if (BENIGN_ENGINE_IO_CODES.has(err?.code)) return;
  Sentry.captureException(err, { tags: { source: "socket.io-engine" } });
});

process.on("unhandledRejection", (reason) => {
  Sentry.captureException(reason, { tags: { source: "unhandledRejection" } });
  log.error("unhandled rejection", { reason: String(reason) });
});

start().catch((err) => { log.error("failed to start", { error: String(err) }); process.exit(1); });
