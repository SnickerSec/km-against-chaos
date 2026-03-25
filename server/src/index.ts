import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { join } from "path";
import { existsSync } from "fs";
import type { ClientEvents, ServerEvents } from "./types.js";
import { createLobby, joinLobby, leaveLobby, startGame, getLobbyPlayers, getLobbyForSocket, getPlayerNameInLobby, getLobbyDeckId, remapPlayer, disconnectPlayer } from "./lobby.js";
import deckRoutes from "./deckRoutes.js";
import authRoutes from "./authRoutes.js";
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
} from "./game.js";
import {
  registerSession,
  getSessionId,
  cancelDisconnectTimer,
} from "./sessions.js";

const app = express();
app.use(cors());

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

// Deck CRUD API
app.use("/api/auth", authRoutes);
app.use("/api/decks", deckRoutes);

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
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health" || req.path.startsWith("/socket.io")) {
      return next();
    }
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    // Try exact path as .html (e.g. /decks/edit -> /decks/edit.html)
    const htmlFile = join(clientDir, req.path + ".html");
    if (existsSync(htmlFile)) {
      return res.sendFile(htmlFile);
    }
    // Try as directory index (e.g. /decks -> /decks.html or /decks/index.html)
    const indexFile = join(clientDir, req.path, "index.html");
    if (existsSync(indexFile)) {
      return res.sendFile(indexFile);
    }
    // SPA fallback
    res.sendFile(join(clientDir, "index.html"));
  });
}

// Chat history per lobby (capped at 100 messages)
const chatHistory = new Map<string, { id: string; playerName: string; text: string; timestamp: number }[]>();

function addChatMessage(code: string, msg: { id: string; playerName: string; text: string; timestamp: number }) {
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
    const players = getLobbyPlayers(code);
    const winnerName = getPlayerName(code, winnerId);

    io.to(code).emit(
      "game:round-winner",
      winnerId,
      winnerName || "Unknown",
      winnerCards || [],
      scores || {}
    );
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

  socket.on("disconnect", () => {
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
