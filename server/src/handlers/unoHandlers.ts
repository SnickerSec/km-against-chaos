import type { Server, Socket } from "socket.io";
import type { ClientEvents, ServerEvents } from "../types.js";
import {
  playCard as unoPlayCard, drawCard as unoDrawCard,
  callUno, challengeUno, advanceUnoRound,
  botPlayUnoTurn, handleUnoTurnTimeout,
  getUnoCurrentPlayer, isUnoGame, getUnoScores, getUnoPhase,
} from "../unoGame.js";
import { getPlayerNameInLobby } from "../lobby.js";
import {
  findPlayerLobby, sendUnoTurnToPlayers,
  scheduleUnoTurnTimer, clearUnoTurnTimer, recordUnoGameResult,
} from "../socketHelpers.js";

// ── Bot Turn Logic ───────────────────────────────────────────────────────────

export function triggerUnoBotTurn(io: Server<ClientEvents, ServerEvents>, code: string) {
  const currentPid = getUnoCurrentPlayer(code);
  if (!currentPid?.startsWith("bot-")) return;
  const phase = getUnoPhase(code);
  if (phase !== "playing") return;

  setTimeout(() => {
    if (!isUnoGame(code)) return;
    const currentNow = getUnoCurrentPlayer(code);
    if (currentNow !== currentPid) return;

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

    sendUnoTurnToPlayers(io, code);

    if (!("roundOver" in result && result.roundOver)) {
      clearUnoTurnTimer(code);
      scheduleUnoTurnTimer(code, (c) => handleTurnTimeout(io, c));
      triggerUnoBotTurn(io, code);
    }
  }, 1500 + Math.random() * 2000);
}

function handleTurnTimeout(io: Server<ClientEvents, ServerEvents>, code: string) {
  handleUnoTurnTimeout(code);
  sendUnoTurnToPlayers(io, code);
  triggerUnoBotTurn(io, code);
  scheduleUnoTurnTimer(code, (c) => handleTurnTimeout(io, c));
}

/** Factory: returns a timer-expiry callback bound to this io instance. */
export function createUnoTimerCallback(io: Server<ClientEvents, ServerEvents>) {
  return (code: string) => handleTurnTimeout(io, code);
}

// ── Socket Event Registration ────────────────────────────────────────────────

export function registerUnoHandlers(
  io: Server<ClientEvents, ServerEvents>,
  socket: Socket<ClientEvents, ServerEvents>,
) {
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
      scheduleUnoTurnTimer(code, (c) => handleTurnTimeout(io, c));
    }

    sendUnoTurnToPlayers(io, code);
    if (!result.roundOver) triggerUnoBotTurn(io, code);
  });

  socket.on("uno:draw-card", (callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isUnoGame(code)) { callback({ success: false, error: "Not in an Uno game" }); return; }

    const result = unoDrawCard(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true, drawnCard: result.drawnCard });

    clearUnoTurnTimer(code);
    scheduleUnoTurnTimer(code, (c) => handleTurnTimeout(io, c));
    sendUnoTurnToPlayers(io, code);
    triggerUnoBotTurn(io, code);
  });

  socket.on("uno:call-uno", (callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isUnoGame(code)) { callback({ success: false, error: "Not in an Uno game" }); return; }

    const ok = callUno(code, socket.id);
    if (!ok) { callback({ success: false, error: "Can't call Uno right now" }); return; }

    callback({ success: true });
    const playerName = getPlayerNameInLobby(code, socket.id) || "???";
    io.to(code).emit("uno:uno-called", socket.id, playerName);
    sendUnoTurnToPlayers(io, code);
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
    sendUnoTurnToPlayers(io, code);
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
      sendUnoTurnToPlayers(io, code);
      triggerUnoBotTurn(io, code);
      scheduleUnoTurnTimer(code, (c) => handleTurnTimeout(io, c));
    }
  });
}
