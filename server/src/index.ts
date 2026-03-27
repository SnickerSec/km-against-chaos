import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { join, resolve, normalize } from "path";
import { existsSync } from "fs";
import type { ClientEvents, ServerEvents } from "./types.js";
import { createLobby, joinLobby, leaveLobby, startGame, getLobbyPlayers, getLobbyForSocket, getPlayerNameInLobby, getLobbyDeckId, remapPlayer, disconnectPlayer } from "./lobby.js";
import deckRoutes from "./deckRoutes.js";
import authRoutes from "./authRoutes.js";
import adminRoutes from "./adminRoutes.js";
import packRoutes from "./packRoutes.js";
import mediaRoutes from "./mediaRoutes.js";
import { getDeck, seedBuiltInDecks } from "./deckStore.js";
import { initDb } from "./db.js";
import {
  createGame,
  startRound,
  getPlayerView,
  submitCards,
  getJudgingData,
  pickWinner,
  getWinnerCards,
  advanceRound,
  getScores,
  isGameOver,
  endGame,
  cleanupGame,
  getPlayerIds,
  remapGamePlayer,
  addPlayerToGame,
  removePlayerFromGame,
  resetPlayerHand,
  resolveMetaTargets,
} from "./game.js";
import {
  registerSession,
  getSessionId,
  cancelDisconnectTimer,
} from "./sessions.js";

const app = express();
app.set("trust proxy", 1); // trust Railway's proxy for correct client IP in rate limiting
app.use(helmet({
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Set CSP header before Railway's CDN can inject a restrictive one.
// Next.js static export requires 'unsafe-inline' for hydration scripts.
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
    ].join("; ")
  );
  next();
});

const httpServer = createServer(app);
const io = new Server<ClientEvents, ServerEvents>(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
  // Frequent pings keep the WebSocket alive through Railway's proxy
  pingInterval: 10_000,
  pingTimeout: 5_000,
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Rate limiting for API routes
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, please try again later" },
});
const staticLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/admin", apiLimiter, adminRoutes);
app.use("/api/decks", apiLimiter, deckRoutes);
app.use("/api/packs", apiLimiter, packRoutes);
app.use("/api/gifs", staticLimiter, mediaRoutes);

// Serve static Next.js export in production
const possibleClientDirs = [
  join(process.cwd(), "client", "out"),
  join(process.cwd(), "..", "client", "out"),
];
const clientDir = possibleClientDirs.find((d) => existsSync(d)) || "";
if (clientDir) {
  // Cache hashed assets (JS/CSS chunks) long-term, but never cache HTML
  app.use(express.static(clientDir, {
    setHeaders: (res, path) => {
      if (path.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }));
  // Serve Next.js static export pages, then fall back to index.html
  app.get("*", staticLimiter, (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health" || req.path.startsWith("/socket.io")) {
      return next();
    }
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    // Sanitize path to prevent directory traversal
    const safePath = normalize(req.path).replace(/^(\.\.[\/\\])+/, "");
    const resolvedBase = resolve(clientDir);
    // Try exact path as .html (e.g. /decks/edit -> /decks/edit.html)
    const htmlFile = resolve(clientDir, "." + safePath + ".html");
    if (htmlFile.startsWith(resolvedBase) && existsSync(htmlFile)) {
      return res.sendFile(htmlFile);
    }
    // Try as directory index (e.g. /decks -> /decks.html or /decks/index.html)
    const indexFile = resolve(clientDir, "." + safePath, "index.html");
    if (indexFile.startsWith(resolvedBase) && existsSync(indexFile)) {
      return res.sendFile(indexFile);
    }
    // SPA fallback
    res.sendFile(join(clientDir, "index.html"));
  });
}

// Voice chat participants per lobby: lobbyCode → Set<socketId>
const voiceUsers = new Map<string, Set<string>>();

function getVoiceUsers(code: string): Set<string> {
  if (!voiceUsers.has(code)) voiceUsers.set(code, new Set());
  return voiceUsers.get(code)!;
}

function removeFromVoice(socketId: string) {
  for (const [code, users] of voiceUsers) {
    if (users.has(socketId)) {
      users.delete(socketId);
      io.to(code).emit("voice:user-left", socketId);
      if (users.size === 0) voiceUsers.delete(code);
      break;
    }
  }
}

// Chat history per lobby (capped at 100 messages)
const chatHistory = new Map<string, { id: string; playerName: string; text: string; gifUrl?: string; timestamp: number }[]>();

function addChatMessage(code: string, msg: { id: string; playerName: string; text: string; gifUrl?: string; timestamp: number }) {
  let history = chatHistory.get(code);
  if (!history) {
    history = [];
    chatHistory.set(code, history);
  }
  history.push(msg);
  if (history.length > 100) {
    history.shift();
  }
}

function getChatHistory(code: string) {
  return chatHistory.get(code) || [];
}

function clearChatHistory(code: string) {
  chatHistory.delete(code);
}

function sendRoundToPlayers(code: string) {
  const playerIds = getPlayerIds(code);
  for (const pid of playerIds) {
    const view = getPlayerView(code, pid);
    if (view) {
      io.to(pid).emit("game:round-start", view);
    }
  }
}

io.on("connection", (socket) => {
  const sessionId: string = socket.handshake.auth?.sessionId || socket.id;
  const { isReconnect, oldSocketId } = registerSession(sessionId, socket.id);

  if (isReconnect && oldSocketId) {
    // Cancel any legacy disconnect timer
    cancelDisconnectTimer(sessionId);

    // Remap player in lobby and game state
    const lobbyResult = remapPlayer(oldSocketId, socket.id);

    if (lobbyResult) {
      const { code, lobby } = lobbyResult;
      socket.join(code);

      // Remap in game state too
      remapGamePlayer(code, oldSocketId, socket.id);

      // Get current game view if game is in progress
      const gameView = lobby.status === "playing"
        ? getPlayerView(code, socket.id)
        : null;

      // Send full state to the reconnected player
      socket.emit("session:reconnected", {
        lobby,
        gameView,
        chatHistory: getChatHistory(code),
        screen: lobby.status === "playing" ? "game" : "lobby",
      });

      // Notify others the player is back
      socket.to(code).emit("lobby:player-reconnected", socket.id);
      io.to(code).emit("lobby:updated", lobby);

      console.log(`Player reconnected: ${socket.id} (session ${sessionId})`);
    } else {
      console.log(`Player connected: ${socket.id}`);
    }
  } else {
    console.log(`Player connected: ${socket.id}`);
  }

  // ── Lobby Events ──

  socket.on("lobby:create", async (playerName, deckId, callback) => {
    try {
      const deck = await getDeck(deckId);
      if (!deck) {
        callback({ success: false, error: "Deck not found" });
        return;
      }

      const result = createLobby(socket.id, playerName, deckId, deck.name);

      if ("error" in result) {
        callback({ success: false, error: result.error });
        return;
      }

      socket.join(result.lobby.code);
      callback({ success: true, lobby: result.lobby });
      console.log(`Lobby ${result.lobby.code} created by ${playerName} with deck "${deck.name}"`);
    } catch (e: any) {
      callback({ success: false, error: "Server error" });
    }
  });

  socket.on("lobby:join", (code, playerName, callback) => {
    const result = joinLobby(socket.id, code, playerName);

    if ("error" in result) {
      callback({ success: false, error: result.error });
      return;
    }

    socket.join(result.lobby.code);

    // If game is in progress, add the player to the active game
    if (result.lobby.status === "playing") {
      addPlayerToGame(result.lobby.code, socket.id);
      const gameView = getPlayerView(result.lobby.code, socket.id);
      callback({ success: true, lobby: result.lobby });

      socket.to(result.lobby.code).emit("lobby:player-joined", result.player);
      io.to(result.lobby.code).emit("lobby:updated", result.lobby);

      // Send them straight into the game
      if (gameView) {
        socket.emit("game:round-start", gameView);
        socket.emit("lobby:started");
      }
    } else {
      callback({ success: true, lobby: result.lobby });
      socket.to(result.lobby.code).emit("lobby:player-joined", result.player);
      socket.to(result.lobby.code).emit("lobby:updated", result.lobby);
    }

    console.log(`${playerName} joined lobby ${code}`);
  });

  socket.on("lobby:leave", () => {
    handleLeave(socket.id);
  });

  socket.on("lobby:start", async (callback) => {
    try {
      const result = startGame(socket.id);

      if ("error" in result) {
        callback({ success: false, error: result.error });
        return;
      }

      const playerIds = getLobbyPlayers(result.code);
      if (!playerIds || playerIds.length < 2) {
        callback({ success: false, error: "Not enough players" });
        return;
      }

      // Load deck from lobby
      const deckId = getLobbyDeckId(result.code);
      let customChaos = undefined;
      let customKnowledge = undefined;
      let winCondition = undefined;
      if (deckId) {
        const deck = await getDeck(deckId);
        if (deck) {
          customChaos = deck.chaosCards;
          customKnowledge = deck.knowledgeCards;
          winCondition = deck.winCondition;
        }
      }

      createGame(result.code, playerIds, customChaos, customKnowledge, winCondition);
      const round = startRound(result.code);

      callback({ success: true });
      io.to(result.code).emit("lobby:started");

      if (round) {
        sendRoundToPlayers(result.code);
      }

      console.log(`Game started in lobby ${result.code}`);
    } catch (e: any) {
      callback({ success: false, error: "Server error" });
    }
  });

  // ── Game Events ──

  socket.on("game:submit", (cardIds, callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code) {
      callback({ success: false, error: "Not in a game" });
      return;
    }

    const result = submitCards(code, socket.id, cardIds);
    if (!result.success) {
      callback({ success: false, error: result.error });
      return;
    }

    callback({ success: true });

    // Notify others that this player submitted
    socket.to(code).emit("game:player-submitted", socket.id);

    // If all submitted, send judging data to everyone
    if (result.allSubmitted) {
      const judgingData = getJudgingData(code);
      if (judgingData) {
        io.to(code).emit("game:judging", judgingData.submissions, judgingData.chaosCard);
      }
    }
  });

  socket.on("game:pick-winner", (winnerId, callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code) {
      callback({ success: false, error: "Not in a game" });
      return;
    }

    const result = pickWinner(code, socket.id, winnerId);
    if (!result.success) {
      callback({ success: false, error: result.error });
      return;
    }

    callback({ success: true });

    // Get winner info
    const scores = getScores(code);
    const winnerCards = getWinnerCards(code);
    const winnerName = getPlayerName(code, winnerId);

    io.to(code).emit(
      "game:round-winner",
      winnerId,
      winnerName || "Unknown",
      winnerCards || [],
      scores || {}
    );

    // Apply meta card effects if the chaos card had one
    if (result.metaEffect) {
      const { effect, winnerId: wId, czarId, playerIds } = result.metaEffect;
      const targets = resolveMetaTargets(effect.target, wId, czarId, playerIds);

      // Hand reset: clear hands and re-deal
      if (effect.type === "hand_reset") {
        for (const pid of targets) {
          const newHand = resetPlayerHand(code, pid);
          io.to(pid).emit("game:hand-updated", newHand);
        }
      }

      // Build human-readable description
      const affectedNames = targets.map((pid) => getPlayerName(code, pid) || "???");
      let description = "";
      switch (effect.type) {
        case "score_add":
          description = `+${effect.value} point${effect.value !== 1 ? "s" : ""} for ${affectedNames.join(", ")}`;
          break;
        case "score_subtract":
          description = `-${effect.value} point${effect.value !== 1 ? "s" : ""} from ${affectedNames.join(", ")}`;
          break;
        case "hide_cards":
          description = `${affectedNames.join(", ")}'s cards are hidden for ${Math.round((effect.durationMs || 20000) / 1000)}s`;
          break;
        case "randomize_icons":
          description = `Icons randomized for ${affectedNames.join(", ")} for ${Math.round((effect.durationMs || 15000) / 1000)}s`;
          break;
        case "hand_reset":
          description = `${affectedNames.join(", ")} drew a fresh hand`;
          break;
      }

      // Broadcast to all players — clients use affectedPlayerIds to know if they're hit
      io.to(code).emit("game:meta-effect", {
        effectType: effect.type,
        value: effect.value,
        affectedPlayerIds: targets,
        description,
      });
    }
  });

  socket.on("game:next-round", () => {
    const code = findPlayerLobby(socket.id);
    if (!code) return;

    advanceRound(code);

    if (isGameOver(code)) {
      const scores = getScores(code);
      endGame(code);
      io.to(code).emit("game:over", scores || {});
      return;
    }

    const round = startRound(code);
    if (round) {
      sendRoundToPlayers(code);
    } else {
      // No more rounds
      const scores = getScores(code);
      endGame(code);
      io.to(code).emit("game:over", scores || {});
    }
  });

  // ── Voice Chat Signaling ──

  socket.on("voice:join", (callback) => {
    const code = getLobbyForSocket(socket.id);
    if (!code) return;

    const users = getVoiceUsers(code);
    users.add(socket.id);

    // Tell everyone else a new voice user joined
    const name = getPlayerName(code, socket.id) || "???";
    socket.to(code).emit("voice:user-joined", { id: socket.id, name });

    // Return the current list of other voice participants to the joiner
    const existing = Array.from(users)
      .filter((id) => id !== socket.id)
      .map((id) => ({ id, name: getPlayerName(code, id) || "???" }));
    callback({ voiceUsers: existing });
  });

  socket.on("voice:leave", () => {
    removeFromVoice(socket.id);
  });

  // Pure relay — validate both sender and target are in the same lobby
  socket.on("voice:offer", (targetId, sdp) => {
    const senderCode = getLobbyForSocket(socket.id);
    const targetCode = getLobbyForSocket(targetId);
    if (!senderCode || senderCode !== targetCode) return;
    io.to(targetId).emit("voice:offer", socket.id, sdp);
  });

  socket.on("voice:answer", (targetId, sdp) => {
    const senderCode = getLobbyForSocket(socket.id);
    const targetCode = getLobbyForSocket(targetId);
    if (!senderCode || senderCode !== targetCode) return;
    io.to(targetId).emit("voice:answer", socket.id, sdp);
  });

  socket.on("voice:ice-candidate", (targetId, candidate) => {
    const senderCode = getLobbyForSocket(socket.id);
    const targetCode = getLobbyForSocket(targetId);
    if (!senderCode || senderCode !== targetCode) return;
    io.to(targetId).emit("voice:ice-candidate", socket.id, candidate);
  });

  // ── Reactions ──

  const reactionCooldowns = new Map<string, number>();

  socket.on("reaction:send", (emoji) => {
    const code = findPlayerLobby(socket.id);
    if (!code) return;

    // Rate limit: 1 reaction per 500ms per player
    const now = Date.now();
    const last = reactionCooldowns.get(socket.id) || 0;
    if (now - last < 500) return;
    reactionCooldowns.set(socket.id, now);

    // Validate emoji (only allow common emojis, max 2 chars)
    if (!emoji || emoji.length > 2) return;

    const playerName = getPlayerName(code, socket.id) || "???";
    io.to(code).emit("reaction:broadcast", emoji, playerName);
  });

  // ── Chat ──

  const chatCooldowns = new Map<string, number>();

  socket.on("chat:send", (message) => {
    const code = findPlayerLobby(socket.id);
    if (!code) return;

    // Rate limit: 1 message per 300ms
    const now = Date.now();
    const last = chatCooldowns.get(socket.id) || 0;
    if (now - last < 300) return;
    chatCooldowns.set(socket.id, now);

    // Validate
    if (!message || typeof message !== "string") return;
    const text = message.trim().slice(0, 200);
    if (text.length === 0) return;

    const playerName = getPlayerName(code, socket.id) || "???";
    const msg = { id: `${socket.id}-${now}`, playerName, text, timestamp: now };
    addChatMessage(code, msg);
    io.to(code).emit("chat:message", msg);
  });

  const ALLOWED_MEDIA_HOSTS = ["media.giphy.com", "media0.giphy.com", "media1.giphy.com", "media2.giphy.com", "media3.giphy.com", "media4.giphy.com", "media.tenor.com", "c.tenor.com"];

  function isAllowedMediaUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        ALLOWED_MEDIA_HOSTS.some((h) => parsed.hostname === h);
    } catch {
      return false;
    }
  }

  let lastGifTime = 0;
  socket.on("chat:gif", (gifUrl: string) => {
    const now = Date.now();
    if (now - lastGifTime < 1000) return;
    lastGifTime = now;
    if (typeof gifUrl !== "string" || !isAllowedMediaUrl(gifUrl)) return;
    const code = getLobbyForSocket(socket.id);
    const playerName = getPlayerNameInLobby(code || "", socket.id);
    if (!code || !playerName) return;
    const msg = { id: `${Date.now()}-${Math.random()}`, playerName, text: "", gifUrl, timestamp: Date.now() };
    addChatMessage(code, msg);
    io.to(code).emit("chat:message", msg);
  });

  let lastStickerTime = 0;
  socket.on("media:sticker", (url: string) => {
    const now = Date.now();
    if (now - lastStickerTime < 2000) return;
    lastStickerTime = now;
    if (typeof url !== "string" || !isAllowedMediaUrl(url)) return;
    const code = getLobbyForSocket(socket.id);
    const playerName = getPlayerNameInLobby(code || "", socket.id);
    if (!code || !playerName) return;
    io.to(code).emit("media:sticker", url, playerName);
  });

  socket.on("disconnect", () => {
    removeFromVoice(socket.id);
    // Mark player as disconnected but keep them in the lobby.
    // The lobby persists until players explicitly leave.
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

function handleLeave(socketId: string) {
  removeFromVoice(socketId);
  const code = getLobbyForSocket(socketId);

  const result = leaveLobby(socketId);
  if (!result) return;

  // Remove from active game so it doesn't block on their submissions
  if (code) {
    removePlayerFromGame(code, socketId);
  }

  // The socket may already be disconnected (timer-based cleanup),
  // so use io.to() for broadcasting instead of socket methods.
  if (result.lobby) {
    io.to(result.code).emit("lobby:updated", result.lobby);
    io.to(result.code).emit("lobby:player-left", socketId);

    if (result.newHostId) {
      io.to(result.code).emit("lobby:host-changed", result.newHostId);
    }
  } else {
    // Lobby was deleted (last player left) — clean up game and chat
    cleanupGame(result.code);
    clearChatHistory(result.code);
  }
}

// Helper: find which lobby a socket belongs to
function findPlayerLobby(socketId: string): string | undefined {
  return getLobbyForSocket(socketId);
}

// Helper: get a player's display name from lobby
function getPlayerName(code: string, playerId: string): string | undefined {
  return getPlayerNameInLobby(code, playerId);
}

const PORT = process.env.PORT || 3001;

async function start() {
  if (process.env.DATABASE_URL) {
    await initDb();
    await seedBuiltInDecks();
  } else {
    console.warn("No DATABASE_URL set — database features disabled");
  }

  httpServer.listen(PORT, () => {
    console.log(`Decked server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
