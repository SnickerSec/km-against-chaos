import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { join, resolve, normalize } from "path";
import { existsSync } from "fs";
import type { ClientEvents, ServerEvents } from "./types.js";
import { createLobby, joinLobby, leaveLobby, startGame, getLobbyPlayers, getLobbyForSocket, getPlayerNameInLobby, getLobbyDeckId, getLobbyDeckName, getLobbyGameType, isPlayerBot, remapPlayer, disconnectPlayer, addBot, removeBot, getBotsInLobby, kickPlayer, joinAsSpectator, getActivePlayers, resetLobbyForRematch, changeLobbyDeck, voteRematch, setLobbyHouseRules, getLobbyHouseRules } from "./lobby.js";
import deckRoutes from "./deckRoutes.js";
import authRoutes from "./authRoutes.js";
import adminRoutes from "./adminRoutes.js";
import packRoutes from "./packRoutes.js";
import mediaRoutes from "./mediaRoutes.js";
import tgcRoutes from "./tgcRoutes.js";
import statsRoutes from "./statsRoutes.js";
import friendRoutes from "./friendRoutes.js";
import { recordGameResult } from "./statsStore.js";
import { getDeck, seedBuiltInDecks } from "./deckStore.js";
import pool, { initDb } from "./db.js";
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
  botSubmitCards,
  botPickWinner,
  getCzarId,
  forceSubmitForMissing,
  getPhaseDeadline,
  czarSetup,
  botCzarSetup,
  forceCzarSetup,
  getGameType,
  getCurrentPhase,
} from "./game.js";
import {
  createUnoGame,
  getUnoPlayerView,
  playCard as unoPlayCard,
  drawCard as unoDrawCard,
  callUno,
  challengeUno,
  advanceUnoRound,
  botPlayUnoTurn,
  handleUnoTurnTimeout,
  getUnoPlayerIds,
  getUnoCurrentPlayer,
  isUnoGame,
  cleanupUnoGame,
  remapUnoGamePlayer,
  getUnoScores,
  isUnoGameOver,
  getUnoPhase,
} from "./unoGame.js";
import type { UnoDeckTemplate, UnoColor } from "./types.js";
import { createCodenamesGame, isCodenamesGame, getCodenamesPlayerView, joinTeam, startCodenamesRound, giveClue, guessWord, passTurn, cleanupCodenamesGame, getCodenamesScores } from "./codenamesGame.js";
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
app.use("/api/print/tgc", apiLimiter, tgcRoutes);
app.use(apiLimiter, statsRoutes);
app.use(apiLimiter, friendRoutes);

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

// Unified bot action trigger: handles czar_setup (JH) then submissions
function triggerBotActions(code: string) {
  const gt = getGameType(code);
  const phase = getCurrentPhase(code);
  if (gt === "joking_hazard" && phase === "czar_setup") {
    // Regular JH round — czar needs to play setup card first
    const czarId = getCzarId(code);
    if (czarId?.startsWith("bot-")) {
      setTimeout(() => {
        const result = botCzarSetup(code, czarId);
        if (result.success && result.czarSetupCard) {
          sendRoundToPlayers(code);
          scheduleRoundTimer(code);
          triggerBotSubmissions(code);
        }
      }, 1500 + Math.random() * 1500);
      return;
    }
    return; // Human czar — wait for their setup
  }
  // CAH or JH bonus round (already in submitting phase) — go straight to bot submissions
  triggerBotSubmissions(code);
}

// Bot auto-play: bots submit cards and pick winners with small delays
function triggerBotSubmissions(code: string) {
  const botIds = getBotsInLobby(code);
  const czarId = getCzarId(code);

  let delay = 1500; // stagger bot submissions
  for (const botId of botIds) {
    if (botId === czarId) continue;
    setTimeout(() => {
      const result = botSubmitCards(code, botId);
      if (result.success) {
        // Notify human players this bot submitted
        io.to(code).emit("game:player-submitted", botId);

        if (result.allSubmitted) {
          const judgingData = getJudgingData(code);
          if (judgingData) {
            io.to(code).emit("game:judging", judgingData.submissions, judgingData.chaosCard);
            // If czar is a bot, auto-pick winner
            triggerBotCzarPick(code);
          }
        }
      }
    }, delay);
    delay += 800 + Math.random() * 1200; // 0.8-2s between bots
  }
}

function triggerBotCzarPick(code: string) {
  const czarId = getCzarId(code);
  if (!czarId?.startsWith("bot-")) return;

  setTimeout(() => {
    const result = botPickWinner(code, czarId);
    if (!result.winnerId) return;

    const scores = getScores(code);
    const winnerCards = getWinnerCards(code);
    const winnerName = getPlayerNameInLobby(code, result.winnerId);

    io.to(code).emit(
      "game:round-winner",
      result.winnerId,
      winnerName || "Unknown",
      winnerCards || [],
      scores || {}
    );

    // Handle meta effects (same as human czar path)
    if (result.metaEffect) {
      const { effect, winnerId: wId, czarId: cId, playerIds } = result.metaEffect;
      const targets = resolveMetaTargets(effect.target, wId, cId, playerIds);

      if (effect.type === "hand_reset") {
        for (const pid of targets) {
          const newHand = resetPlayerHand(code, pid);
          io.to(pid).emit("game:hand-updated", newHand);
        }
      }

      const affectedNames = targets.map((pid: string) => getPlayerNameInLobby(code, pid) || "???");
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

      io.to(code).emit("game:meta-effect", {
        effectType: effect.type,
        value: effect.value,
        affectedPlayerIds: targets,
        description,
      });
    }
  }, 8000 + Math.random() * 4000); // 8-12s delay for czar pick so players can read submissions
}

// ── Round Timer ──
// Tracks active timers per lobby so we can cancel on phase change
const roundTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleRoundTimer(code: string) {
  // Clear any existing timer
  clearRoundTimer(code);

  const deadline = getPhaseDeadline(code);
  if (!deadline) return;

  const delay = Math.max(0, deadline - Date.now());
  roundTimers.set(code, setTimeout(() => {
    roundTimers.delete(code);
    handleTimerExpiry(code);
  }, delay));
}

function clearRoundTimer(code: string) {
  const existing = roundTimers.get(code);
  if (existing) {
    clearTimeout(existing);
    roundTimers.delete(code);
  }
}

function handleTimerExpiry(code: string) {
  const czarId = getCzarId(code);

  // If in czar_setup phase (Joking Hazard), auto-play a random card
  const gt = getGameType(code);
  if (gt === "joking_hazard") {
    const setupCard = forceCzarSetup(code);
    if (setupCard) {
      sendRoundToPlayers(code);
      scheduleRoundTimer(code);
      triggerBotSubmissions(code);
      return;
    }
  }

  // If still in submitting phase, force-submit for missing players
  const forced = forceSubmitForMissing(code);
  if (forced.length > 0) {
    // Notify which players were auto-submitted
    for (const pid of forced) {
      io.to(code).emit("game:player-submitted", pid);
    }
    const judgingData = getJudgingData(code);
    if (judgingData) {
      io.to(code).emit("game:judging", judgingData.submissions, judgingData.chaosCard);
      // Schedule judge timer
      scheduleRoundTimer(code);
      triggerBotCzarPick(code);
    }
    return;
  }

  // If in judging phase and czar hasn't picked, auto-pick random winner
  if (czarId) {
    const result = botPickWinner(code, czarId);
    if (result.winnerId) {
      const scores = getScores(code);
      const winnerCards = getWinnerCards(code);
      const winnerName = getPlayerNameInLobby(code, result.winnerId);

      io.to(code).emit(
        "game:round-winner",
        result.winnerId,
        winnerName || "Unknown",
        winnerCards || [],
        scores || {}
      );

      if (result.metaEffect) {
        const { effect, winnerId: wId, czarId: cId, playerIds } = result.metaEffect;
        const targets = resolveMetaTargets(effect.target, wId, cId, playerIds);
        if (effect.type === "hand_reset") {
          for (const pid of targets) {
            const newHand = resetPlayerHand(code, pid);
            io.to(pid).emit("game:hand-updated", newHand);
          }
        }
        const affectedNames = targets.map((pid: string) => getPlayerNameInLobby(code, pid) || "???");
        let description = "";
        switch (effect.type) {
          case "score_add": description = `+${effect.value} point${effect.value !== 1 ? "s" : ""} for ${affectedNames.join(", ")}`; break;
          case "score_subtract": description = `-${effect.value} point${effect.value !== 1 ? "s" : ""} from ${affectedNames.join(", ")}`; break;
          case "hide_cards": description = `${affectedNames.join(", ")}'s cards are hidden for ${Math.round((effect.durationMs || 20000) / 1000)}s`; break;
          case "randomize_icons": description = `Icons randomized for ${affectedNames.join(", ")} for ${Math.round((effect.durationMs || 15000) / 1000)}s`; break;
          case "hand_reset": description = `${affectedNames.join(", ")} drew a fresh hand`; break;
        }
        io.to(code).emit("game:meta-effect", { effectType: effect.type, value: effect.value, affectedPlayerIds: targets, description });
      }
    }
  }
}

// ── Uno Helpers ──

function sendUnoTurnToPlayers(code: string) {
  const playerIds = getUnoPlayerIds(code);
  for (const pid of playerIds) {
    const view = getUnoPlayerView(code, pid);
    if (view) io.to(pid).emit("uno:turn-update", view);
  }
}

function sendCodenamesUpdate(code: string) {
  const players = getLobbyPlayers(code);
  if (!players) return;
  for (const pid of players) {
    const view = getCodenamesPlayerView(code, pid);
    if (view) {
      const playerSocket = io.sockets.sockets.get(pid);
      if (playerSocket) {
        playerSocket.emit("codenames:update" as any, view);
      }
    }
  }
}

const unoTurnTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleUnoTurnTimer(code: string) {
  clearUnoTurnTimer(code);
  unoTurnTimers.set(code, setTimeout(() => {
    unoTurnTimers.delete(code);
    handleUnoTurnTimeout(code);
    sendUnoTurnToPlayers(code);
    triggerUnoBotTurn(code);
    scheduleUnoTurnTimer(code);
  }, TURN_TIMER_MS));
}

function clearUnoTurnTimer(code: string) {
  const t = unoTurnTimers.get(code);
  if (t) { clearTimeout(t); unoTurnTimers.delete(code); }
}

const TURN_TIMER_MS = 30_000;

function triggerUnoBotTurn(code: string) {
  const currentPid = getUnoCurrentPlayer(code);
  if (!currentPid?.startsWith("bot-")) return;
  const phase = getUnoPhase(code);
  if (phase !== "playing") return;

  setTimeout(() => {
    if (!isUnoGame(code)) return;
    const currentNow = getUnoCurrentPlayer(code);
    if (currentNow !== currentPid) return; // turn already advanced

    const result = botPlayUnoTurn(code, currentPid);
    if (!result.success) return;

    const playerName = getPlayerNameInLobby(code, currentPid) || currentPid;

    if ("roundOver" in result && result.roundOver) {
      const scores = getUnoScores(code);
      io.to(code).emit("uno:round-over", result.winnerId!, playerName, scores, result.roundPoints || 0);
      clearUnoTurnTimer(code);
      if (result.gameOver) {
        io.to(code).emit("uno:game-over", scores);
        recordUnoGameResult(code, scores);
      }
    }

    sendUnoTurnToPlayers(code);

    if (!("roundOver" in result && result.roundOver)) {
      clearUnoTurnTimer(code);
      scheduleUnoTurnTimer(code);
      triggerUnoBotTurn(code);
    }
  }, 1500 + Math.random() * 2000);
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
      if (isUnoGame(code)) {
        remapUnoGamePlayer(code, oldSocketId, socket.id);
      } else {
        remapGamePlayer(code, oldSocketId, socket.id);
      }

      // Get current game view if game is in progress
      const gameView = lobby.status === "playing"
        ? (isUnoGame(code) ? null : getPlayerView(code, socket.id))
        : null;

      // Send full state to the reconnected player
      socket.emit("session:reconnected", {
        lobby,
        gameView,
        chatHistory: getChatHistory(code),
        screen: lobby.status === "playing" ? "game" : "lobby",
      });

      // For Uno, also send the Uno-specific view
      if (isUnoGame(code) && lobby.status === "playing") {
        const unoView = getUnoPlayerView(code, socket.id);
        if (unoView) socket.emit("uno:turn-update", unoView);
      }

      // For Codenames, send the Codenames-specific view
      if (isCodenamesGame(code) && lobby.status === "playing") {
        const cnView = getCodenamesPlayerView(code, socket.id);
        if (cnView) socket.emit("codenames:update" as any, cnView);
      }

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

      const result = createLobby(socket.id, playerName, deckId, deck.name, deck.gameType, deck.winCondition);

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

  socket.on("lobby:spectate" as any, (code: string, playerName: string, callback: (response: { success: boolean; lobby?: any; error?: string }) => void) => {
    const result = joinAsSpectator(socket.id, code, playerName);
    if ("error" in result) {
      callback({ success: false, error: result.error });
      return;
    }

    socket.join(result.lobby.code);
    callback({ success: true, lobby: result.lobby });
    socket.to(result.lobby.code).emit("lobby:player-joined", result.player);
    io.to(result.lobby.code).emit("lobby:updated", result.lobby);

    // If game in progress, send them a spectator view
    if (result.lobby.status === "playing") {
      // Spectators see round info but no hand
      const spectatorView = getPlayerView(result.lobby.code, socket.id);
      if (spectatorView) {
        socket.emit("game:round-start", { ...spectatorView, hand: [] });
        socket.emit("lobby:started");
      }
    }

    console.log(`${playerName} joined lobby ${code} as spectator`);
  });

  socket.on("lobby:leave", () => {
    handleLeave(socket.id);
  });

  socket.on("lobby:change-deck" as any, async (deckId: string, callback: (res: any) => void) => {
    try {
      const deck = await getDeck(deckId);
      if (!deck) { callback({ success: false, error: "Deck not found" }); return; }

      const result = changeLobbyDeck(socket.id, deckId, deck.name, deck.gameType || "cah", deck.winCondition);
      if ("error" in result) { callback({ success: false, error: result.error }); return; }

      callback({ success: true, lobby: result.lobby });
      io.to(result.code).emit("lobby:updated", result.lobby);
      console.log(`Deck changed to "${deck.name}" in lobby ${result.code}`);
    } catch (e: any) {
      callback({ success: false, error: e.message });
    }
  });

  socket.on("lobby:set-house-rules" as any, (houseRules: { unoStacking?: boolean }, callback: (res: any) => void) => {
    const result = setLobbyHouseRules(socket.id, houseRules);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }
    callback({ success: true });
    io.to(result.code).emit("lobby:updated", result.lobby);
  });

  socket.on("lobby:start", async (callback) => {
    try {
      const result = startGame(socket.id);

      if ("error" in result) {
        callback({ success: false, error: result.error });
        return;
      }

      const playerIds = getActivePlayers(result.code);
      if (!playerIds || playerIds.length < 2) {
        callback({ success: false, error: "Not enough players" });
        return;
      }

      // Load deck from lobby
      const deckId = getLobbyDeckId(result.code);
      let customChaos = undefined;
      let customKnowledge = undefined;
      let winCondition = undefined;
      let gameType: "cah" | "joking_hazard" | "apples_to_apples" | "uno" | "codenames" | undefined = undefined;
      let unoTemplate: UnoDeckTemplate | undefined = undefined;
      if (deckId) {
        const deck = await getDeck(deckId);
        if (deck) {
          customChaos = deck.chaosCards;
          customKnowledge = deck.knowledgeCards;
          winCondition = deck.winCondition;
          gameType = deck.gameType as typeof gameType;
          // For Uno, extract template from chaosCards[0].text (JSON string)
          if (gameType === "uno" && deck.chaosCards?.length > 0) {
            try {
              const raw = deck.chaosCards[0] as any;
              if (raw.colorNames) {
                // Already parsed object
                unoTemplate = raw as UnoDeckTemplate;
              } else if (raw.text) {
                // Template stored as JSON string in text field
                const parsed = JSON.parse(raw.text);
                if (parsed.colorNames) unoTemplate = parsed as UnoDeckTemplate;
              }
            } catch {}
          }
        }
      }

      callback({ success: true });

      // Increment deck play count
      if (deckId) {
        pool.query("UPDATE decks SET play_count = COALESCE(play_count, 0) + 1 WHERE id = $1", [deckId]).catch(() => {});
      }

      // 3-2-1 countdown before game starts
      const code = result.code;
      io.to(code).emit("lobby:countdown" as any, 3);
      setTimeout(() => io.to(code).emit("lobby:countdown" as any, 2), 1000);
      setTimeout(() => io.to(code).emit("lobby:countdown" as any, 1), 2000);
      setTimeout(() => {
        io.to(code).emit("lobby:countdown" as any, 0);
        io.to(code).emit("lobby:started");

        if (gameType === "codenames") {
          // Extract word pool from knowledge cards
          const wordPool = (customKnowledge || []).map(c => c.text).filter(t => t.trim());
          if (wordPool.length < 25) {
            // Fallback: use a default word list
            const defaults = ["Apple","Bank","Bark","Bear","Berlin","Board","Bond","Boot","Bowl","Bug","Canada","Card","Castle","Cat","Cell","Chair","Change","Chest","China","Clip","Cloud","Club","Code","Cold","Comet","Compound","Copper","Crane","Crash","Cricket","Cross","Crown","Cycle","Day","Death","Diamond","Dice","Doctor","Dog","Draft","Dragon","Dress","Drill","Drop","Duck","Dwarf","Eagle","Egypt","Engine","Eye","Fair","Fan","Field","File","Film","Fire","Fish","Fly","Force","Forest","Fork","France","Game","Gas","Ghost","Giant","Glass","Glove","Gold","Grass","Green","Ham","Hand","Hawk","Head","Heart","Himalayas","Hit","Hole","Hook","Horn","Horse","Hospital","Hotel","Ice","Iron","Ivory","Jack","Jam","Jet","Jupiter","Kangaroo","Ketchup","Key","Kid","King","Kite","Knight","Lab","Lap","Laser","Lead","Lemon","Life","Light","Limousine","Line","Link","Lion","Lock","Log","London","Luck","Mail","Mammoth","Maple","March","Mass","Match","Mercury","Mexico","Microscope","Milk","Mine","Model","Mole","Moon","Moscow","Mount","Mouse","Mud","Mug","Nail","Net","Night","Ninja","Note","Novel","Nurse","Nut","Octopus","Oil","Olive","Olympus","Opera","Orange","Organ","Palm","Pan","Pants","Paper","Park","Pass","Paste","Penguin","Phoenix","Piano","Pie","Pilot","Pin","Pipe","Pirate","Pistol","Pit","Plate","Play","Plot","Point","Poison","Pole","Pool","Port","Post","Press","Princess","Pumpkin","Pupil","Queen","Rabbit","Race","Radio","Rain","Ranch","Ray","Revolution","Ring","Robin","Robot","Rock","Rome","Root","Rose","Round","Row","Ruler","Russia","Sail","Sand","Saturn","Scale","School","Scientist","Screen","Seal","Server","Shadow","Shakespeare","Shark","Ship","Shoe","Shop","Shot","Silk","Singer","Sink","Slip","Slug","Smuggler","Snow","Soldier","Soul","Space","Spell","Spider","Spike","Spot","Spring","Spy","Square","Staff","Star","State","Steam","Steel","Stick","Stock","Storm","Stream","Strike","String","Sub","Sugar","Suit","Super","Swan","Switch","Table","Tail","Tap","Teacher","Temple","Texas","Theater","Thief","Thumb","Tick","Tie","Tiger","Time","Tokyo","Tooth","Tower","Track","Train","Triangle","Trip","Trunk","Tube","Turkey","Undertaker","Unicorn","Vacuum","Van","Vet","Violet","Virus","Wall","War","Wash","Washington","Watch","Water","Wave","Web","Well","Whale","Whip","Wind","Witch","Worm","Yard"];
            wordPool.push(...defaults);
          }
          createCodenamesGame(code, playerIds, wordPool);
          // Send initial view to all players (team pick phase)
          for (const pid of playerIds) {
            const view = getCodenamesPlayerView(code, pid);
            if (view) {
              const playerSocket = io.sockets.sockets.get(pid);
              if (playerSocket) {
                playerSocket.emit("codenames:update" as any, view);
              }
            }
          }
        } else if (gameType === "uno") {
          const template = unoTemplate || { colorNames: { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" } };
          const houseRules = getLobbyHouseRules(code);
          createUnoGame(code, playerIds, template, winCondition, houseRules);
          sendUnoTurnToPlayers(code);
          triggerUnoBotTurn(code);
          scheduleUnoTurnTimer(code);
        } else {
          createGame(code, playerIds, customChaos, customKnowledge, winCondition, gameType);
          const round = startRound(code);

          if (round) {
            sendRoundToPlayers(code);
            triggerBotActions(code);
            scheduleRoundTimer(code);
          }
        }

        console.log(`Game started in lobby ${code}`);
      }, 3000);
    } catch (e: any) {
      callback({ success: false, error: "Server error" });
    }
  });

  socket.on("lobby:add-bot" as any, (callback: (response: { success: boolean; error?: string }) => void) => {
    const result = addBot(socket.id);
    if ("error" in result) {
      callback({ success: false, error: result.error });
      return;
    }
    callback({ success: true });
    io.to(result.lobby.code).emit("lobby:updated", result.lobby);
    console.log(`Bot added to lobby ${result.lobby.code}`);
  });

  socket.on("lobby:remove-bot" as any, (botId: string, callback: (response: { success: boolean; error?: string }) => void) => {
    const result = removeBot(socket.id, botId);
    if ("error" in result) {
      callback({ success: false, error: result.error });
      return;
    }
    io.to(result.lobby.code).emit("lobby:updated", result.lobby);
    callback({ success: true });
    console.log(`Bot ${botId} removed from lobby`);
  });

  socket.on("lobby:kick" as any, (targetId: string, callback: (response: { success: boolean; error?: string }) => void) => {
    const result = kickPlayer(socket.id, targetId);
    if ("error" in result) {
      callback({ success: false, error: result.error });
      return;
    }
    // Tell the kicked player
    io.to(targetId).emit("lobby:kicked" as any);
    // Make them leave the socket room
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) targetSocket.leave(result.code);
    // Update everyone else
    io.to(result.code).emit("lobby:updated", result.lobby);
    callback({ success: true });
    console.log(`Player ${targetId} kicked from lobby ${result.code}`);
  });

  // ── Game Events ──

  socket.on("game:czar-setup", (cardId, callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code) {
      callback({ success: false, error: "Not in a game" });
      return;
    }

    clearRoundTimer(code);
    const result = czarSetup(code, socket.id, cardId);
    if (!result.success) {
      callback({ success: false, error: result.error });
      return;
    }

    callback({ success: true });

    // Broadcast updated round state (now in submitting phase with czarSetupCard)
    sendRoundToPlayers(code);
    triggerBotSubmissions(code);
    scheduleRoundTimer(code);
  });

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
        scheduleRoundTimer(code);
        // If czar is a bot, auto-pick winner
        triggerBotCzarPick(code);
      }
    }
  });

  socket.on("game:pick-winner", (winnerId, callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code) {
      callback({ success: false, error: "Not in a game" });
      return;
    }

    clearRoundTimer(code);
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
      recordCahGameResult(code, scores || {});
      return;
    }

    const round = startRound(code);
    if (round) {
      sendRoundToPlayers(code);
      triggerBotActions(code);
      scheduleRoundTimer(code);
    } else {
      // No more rounds
      const scores = getScores(code);
      endGame(code);
      io.to(code).emit("game:over", scores || {});
      recordCahGameResult(code, scores || {});
    }
  });

  socket.on("lobby:vote-rematch" as any, (callback: (response: any) => void) => {
    const result = voteRematch(socket.id);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }
    callback({ success: true, voteCount: result.voteCount, totalPlayers: result.totalPlayers });
    io.to(result.code).emit("lobby:updated", result.lobby);
    io.to(result.code).emit("lobby:rematch-vote" as any, {
      voterId: socket.id,
      voterName: getPlayerNameInLobby(result.code, socket.id),
      voteCount: result.voteCount,
      totalPlayers: result.totalPlayers,
    });
  });

  socket.on("game:rematch" as any, (callback: (response: { success: boolean; error?: string }) => void) => {
    const code = findPlayerLobby(socket.id);
    if (!code) {
      callback({ success: false, error: "Not in a lobby" });
      return;
    }

    clearRoundTimer(code);
    clearUnoTurnTimer(code);
    cleanupGame(code);
    cleanupUnoGame(code);
    cleanupCodenamesGame(code);

    const result = resetLobbyForRematch(socket.id);
    if ("error" in result) {
      callback({ success: false, error: result.error });
      return;
    }

    callback({ success: true });
    io.to(result.code).emit("lobby:updated", result.lobby);
    io.to(result.code).emit("game:rematch" as any);
    console.log(`Rematch started in lobby ${result.code}`);
  });

  // ── Uno Events ──

  socket.on("uno:play-card", (cardId, chosenColor, callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isUnoGame(code)) { callback({ success: false, error: "Not in an Uno game" }); return; }

    const result = unoPlayCard(code, socket.id, cardId, chosenColor || undefined);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });

    const playerName = getPlayerNameInLobby(code, socket.id) || "???";

    if (result.roundOver) {
      const scores = getUnoScores(code);
      io.to(code).emit("uno:round-over", result.winnerId!, playerName, scores, result.roundPoints || 0);
      clearUnoTurnTimer(code);
      if (result.gameOver) {
        io.to(code).emit("uno:game-over", scores);
        recordUnoGameResult(code, scores);
      }
    } else {
      clearUnoTurnTimer(code);
      scheduleUnoTurnTimer(code);
    }

    sendUnoTurnToPlayers(code);
    if (!result.roundOver) triggerUnoBotTurn(code);
  });

  socket.on("uno:draw-card", (callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isUnoGame(code)) { callback({ success: false, error: "Not in an Uno game" }); return; }

    const result = unoDrawCard(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true, drawnCard: result.drawnCard });

    clearUnoTurnTimer(code);
    scheduleUnoTurnTimer(code);
    sendUnoTurnToPlayers(code);
    triggerUnoBotTurn(code);
  });

  socket.on("uno:call-uno", (callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isUnoGame(code)) { callback({ success: false, error: "Not in an Uno game" }); return; }

    const ok = callUno(code, socket.id);
    if (!ok) { callback({ success: false, error: "Can't call Uno right now" }); return; }

    callback({ success: true });
    const playerName = getPlayerNameInLobby(code, socket.id) || "???";
    io.to(code).emit("uno:uno-called", socket.id, playerName);
    sendUnoTurnToPlayers(code);
  });

  socket.on("uno:challenge-uno", (targetId, callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isUnoGame(code)) { callback({ success: false, error: "Not in an Uno game" }); return; }

    const result = challengeUno(code, socket.id, targetId);
    if (!result.success) { callback({ success: false, error: "Can't challenge" }); return; }

    callback({ success: true, penalized: result.penalized });
    if (result.penalized) {
      const targetName = getPlayerNameInLobby(code, targetId) || "???";
      io.to(code).emit("uno:uno-penalty", targetId, targetName);
    }
    sendUnoTurnToPlayers(code);
  });

  socket.on("uno:next-round", () => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isUnoGame(code)) return;

    const result = advanceUnoRound(code);
    if (result.gameOver) {
      const scores = getUnoScores(code);
      io.to(code).emit("uno:game-over", scores);
      recordUnoGameResult(code, scores);
      return;
    }
    if (result.started) {
      sendUnoTurnToPlayers(code);
      triggerUnoBotTurn(code);
      scheduleUnoTurnTimer(code);
    }
  });

  // ── Codenames Events ──

  socket.on("codenames:join-team" as any, (team: string, asSpymaster: boolean, callback: (res: any) => void) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isCodenamesGame(code)) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = joinTeam(code, socket.id, team as any, asSpymaster);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    sendCodenamesUpdate(code);
  });

  socket.on("codenames:start-round" as any, (callback: (res: any) => void) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isCodenamesGame(code)) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = startCodenamesRound(code);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    sendCodenamesUpdate(code);
  });

  socket.on("codenames:give-clue" as any, (word: string, count: number, callback: (res: any) => void) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isCodenamesGame(code)) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = giveClue(code, socket.id, word, count);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    sendCodenamesUpdate(code);
  });

  socket.on("codenames:guess" as any, (wordIndex: number, callback: (res: any) => void) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isCodenamesGame(code)) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = guessWord(code, socket.id, wordIndex);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true, color: result.color, gameOver: result.gameOver, turnOver: result.turnOver });
    sendCodenamesUpdate(code);

    if (result.gameOver) {
      const scores = getCodenamesScores(code);
      if (scores) {
        io.to(code).emit("game:over", scores);
      }
    }
  });

  socket.on("codenames:pass" as any, (callback: (res: any) => void) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isCodenamesGame(code)) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = passTurn(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    sendCodenamesUpdate(code);
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

  const ALLOWED_MEDIA_HOSTS = ["media.giphy.com", "media0.giphy.com", "media1.giphy.com", "media2.giphy.com", "media3.giphy.com", "media4.giphy.com", "media.tenor.com", "c.tenor.com", "static.klipy.com"];

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
    cleanupCodenamesGame(result.code);
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

// Helper: record CAH/JH/A2A game result
function recordCahGameResult(code: string, scores: Record<string, number>) {
  try {
    const playerIds = getActivePlayers(code) || [];
    const topEntry = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const winnerId = topEntry?.[0];
    const players = playerIds.map(pid => ({
      name: getPlayerNameInLobby(code, pid) || pid,
      score: scores[pid] || 0,
      isWinner: pid === winnerId,
      isBot: isPlayerBot(code, pid),
    }));
    recordGameResult({
      lobbyCode: code,
      deckId: getLobbyDeckId(code) || null,
      deckName: getLobbyDeckName(code) || "Unknown",
      gameType: getLobbyGameType(code) || "cah",
      playerCount: players.filter(p => !p.isBot).length,
      roundsPlayed: 0,
      players,
    }).catch(e => console.error("Failed to record game:", e));
  } catch {}
}

// Helper: record Uno game result
function recordUnoGameResult(code: string, scores: Record<string, number>) {
  try {
    const playerIds = getActivePlayers(code) || [];
    const topEntry = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const winnerId = topEntry?.[0];
    const players = playerIds.map(pid => ({
      name: getPlayerNameInLobby(code, pid) || pid,
      score: scores[pid] || 0,
      isWinner: pid === winnerId,
      isBot: isPlayerBot(code, pid),
    }));
    recordGameResult({
      lobbyCode: code,
      deckId: getLobbyDeckId(code) || null,
      deckName: getLobbyDeckName(code) || "Unknown",
      gameType: getLobbyGameType(code) || "uno",
      playerCount: players.filter(p => !p.isBot).length,
      roundsPlayed: 0,
      players,
    }).catch(e => console.error("Failed to record Uno game:", e));
  } catch {}
}

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

  httpServer.listen(PORT, () => {
    console.log(`Decked server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
