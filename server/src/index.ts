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
import { setIO as setNotificationIO } from "./notifications.js";
import { setOffline, getUserIdForSocket, getSocketIdsForUser, remapSocket as remapPresenceSocket } from "./presence.js";
import { remapPartySocket } from "./party.js";
import { seedBuiltInDecks } from "./deckStore.js";
import pool, { initDb } from "./db.js";
import { getPlayerView } from "./game.js";
import { isUnoGame, remapUnoGamePlayer, getUnoPlayerView } from "./unoGame.js";
import { remapGamePlayer } from "./game.js";
import { isCodenamesGame, getCodenamesPlayerView } from "./codenamesGame.js";
import { registerSession, getSessionId, cancelDisconnectTimer } from "./sessions.js";
import { removeFromVoice, getChatHistory } from "./socketHelpers.js";
import { registerLobbyHandlers, handleLeave } from "./handlers/lobbyHandlers.js";
import { registerCahHandlers } from "./handlers/cahHandlers.js";
import { registerUnoHandlers } from "./handlers/unoHandlers.js";
import { registerCodenamesHandlers } from "./handlers/codenamesHandlers.js";
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
      "media-src 'self' https://www.myinstants.com",
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

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/admin", apiLimiter, adminRoutes);
app.use("/api/decks", apiLimiter, deckRoutes);
app.use("/api/packs", apiLimiter, packRoutes);
app.use("/api/gifs", staticLimiter, mediaRoutes);
app.use("/api/print/tgc", apiLimiter, tgcRoutes);
app.use("/api/sounds", apiLimiter, soundRoutes);
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

io.on("connection", (socket) => {
  const sessionId: string = socket.handshake.auth?.sessionId || socket.id;
  const { isReconnect, oldSocketId } = registerSession(sessionId, socket.id);

  if (isReconnect && oldSocketId) {
    cancelDisconnectTimer(sessionId);
    remapPresenceSocket(oldSocketId, socket.id);

    const lobbyResult = remapPlayer(oldSocketId, socket.id);
    if (lobbyResult) {
      const { code, lobby } = lobbyResult;
      socket.join(code);

      if (isUnoGame(code)) remapUnoGamePlayer(code, oldSocketId, socket.id);
      else remapGamePlayer(code, oldSocketId, socket.id);

      const gameView = lobby.status === "playing"
        ? (isUnoGame(code) ? null : getPlayerView(code, socket.id))
        : null;

      socket.emit("session:reconnected", {
        lobby,
        gameView,
        chatHistory: getChatHistory(code),
        screen: lobby.status === "playing" ? "game" : "lobby",
      });

      if (isUnoGame(code) && lobby.status === "playing") {
        const unoView = getUnoPlayerView(code, socket.id);
        if (unoView) socket.emit("uno:turn-update", unoView);
      }
      if (isCodenamesGame(code) && lobby.status === "playing") {
        const cnView = getCodenamesPlayerView(code, socket.id);
        if (cnView) socket.emit("codenames:update" as any, cnView);
      }

      socket.to(code).emit("lobby:player-reconnected", socket.id);
      io.to(code).emit("lobby:updated", lobby);
      console.log(`Player reconnected: ${socket.id} (session ${sessionId})`);
    } else {
      console.log(`Player connected: ${socket.id}`);
    }
  } else {
    console.log(`Player connected: ${socket.id}`);
  }

  // Register all handler groups
  registerSocialHandlers(io, socket);
  registerLobbyHandlers(io, socket);
  registerCahHandlers(io, socket);
  registerUnoHandlers(io, socket);
  registerCodenamesHandlers(io, socket);

  // ── Disconnect ──
  socket.on("disconnect", async () => {
    removeFromVoice(io, socket.id);

    const userId = getUserIdForSocket(socket.id);
    if (userId) {
      const fullyOffline = setOffline(userId, socket.id);
      if (fullyOffline) {
        try {
          const friends = await pool.query(
            `SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END as friend_id
             FROM friendships f WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'`,
            [userId]
          );
          for (const row of friends.rows) {
            const friendSockets = getSocketIdsForUser(row.friend_id);
            for (const sid of friendSockets) io.to(sid).emit("friend:offline" as any, { userId });
          }
        } catch {}
      }
    }

    const result = disconnectPlayer(socket.id);
    if (result) {
      io.to(result.code).emit("lobby:updated", result.lobby);
      io.to(result.code).emit("lobby:player-disconnecting", socket.id);
      console.log(`Player disconnected (kept in lobby): ${socket.id}`);
    } else {
      console.log(`Player disconnected: ${socket.id}`);
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
    } catch (err) {
      console.error("Database initialization failed — continuing without DB:", err);
    }
  } else {
    console.warn("No DATABASE_URL set — database features disabled");
  }
  httpServer.listen(PORT, () => console.log(`Decked server running on port ${PORT}`));
}

function gracefulShutdown(signal: string) {
  console.log(`${signal} received — starting graceful shutdown`);
  io.emit("server_restart", { message: "Server is restarting — you will be reconnected shortly." });
  httpServer.close(() => console.log("HTTP server closed"));
  setTimeout(async () => {
    try {
      io.disconnectSockets(true);
      await pool.end();
      console.log("Database pool closed");
    } catch (err) {
      console.error("Error during shutdown:", err);
    }
    process.exit(0);
  }, 2000);
  setTimeout(() => { console.error("Shutdown timed out — forcing exit"); process.exit(1); }, 10000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

start().catch((err) => { console.error("Failed to start:", err); process.exit(1); });
