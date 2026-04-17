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

export async function triggerUnoBotTurn(io: Server<ClientEvents, ServerEvents>, code: string) {
  const currentPid = await getUnoCurrentPlayer(code);
  if (!currentPid?.startsWith("bot-")) return;
  const phase = await getUnoPhase(code);
  if (phase !== "playing") return;

  setTimeout(async () => {
    if (!(await isUnoGame(code))) return;
    const currentNow = await getUnoCurrentPlayer(code);
    if (currentNow !== currentPid) return;

    const result = await botPlayUnoTurn(code, currentPid);
    if (!result.success) return;

    const playerName = (await getPlayerNameInLobby(code, currentPid)) || currentPid;

    if ("roundOver" in result && result.roundOver) {
      const scores = await getUnoScores(code);
      io.to(code).emit("uno:round-over", result.winnerId!, playerName, scores, result.roundPoints || 0);
      clearUnoTurnTimer(code);
      if (result.gameOver) {
        io.to(code).emit("uno:game-over", scores);
        recordUnoGameResult(code, scores);
      }
    }

    await sendUnoTurnToPlayers(io, code);

    if (!("roundOver" in result && result.roundOver)) {
      clearUnoTurnTimer(code);
      scheduleUnoTurnTimer(code, (c) => handleTurnTimeout(io, c));
      triggerUnoBotTurn(io, code);
    }
  }, 1500 + Math.random() * 2000);
}

async function handleTurnTimeout(io: Server<ClientEvents, ServerEvents>, code: string) {
  await handleUnoTurnTimeout(code);
  await sendUnoTurnToPlayers(io, code);
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
  socket.on("uno:play-card", async (cardId, chosenColor, callback) => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isUnoGame(code))) { callback({ success: false, error: "Not in an Uno game" }); return; }

    const result = await unoPlayCard(code, socket.id, cardId, chosenColor || undefined);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });

    const playerName = (await getPlayerNameInLobby(code, socket.id)) || "???";

    if (result.roundOver) {
      const scores = await getUnoScores(code);
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

    await sendUnoTurnToPlayers(io, code);
    if (!result.roundOver) triggerUnoBotTurn(io, code);
  });

  socket.on("uno:draw-card", async (callback) => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isUnoGame(code))) { callback({ success: false, error: "Not in an Uno game" }); return; }

    const result = await unoDrawCard(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true, drawnCard: result.drawnCard });

    clearUnoTurnTimer(code);
    scheduleUnoTurnTimer(code, (c) => handleTurnTimeout(io, c));
    await sendUnoTurnToPlayers(io, code);
    triggerUnoBotTurn(io, code);
  });

  socket.on("uno:call-uno", async (callback) => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isUnoGame(code))) { callback({ success: false, error: "Not in an Uno game" }); return; }

    const ok = await callUno(code, socket.id);
    if (!ok) { callback({ success: false, error: "Can't call Uno right now" }); return; }

    callback({ success: true });
    const playerName = (await getPlayerNameInLobby(code, socket.id)) || "???";
    io.to(code).emit("uno:uno-called", socket.id, playerName);
    await sendUnoTurnToPlayers(io, code);
  });

  socket.on("uno:challenge-uno", async (targetId, callback) => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isUnoGame(code))) { callback({ success: false, error: "Not in an Uno game" }); return; }

    const result = await challengeUno(code, socket.id, targetId);
    if (!result.success) { callback({ success: false, error: "Can't challenge" }); return; }

    callback({ success: true, penalized: result.penalized });
    if (result.penalized) {
      const targetName = (await getPlayerNameInLobby(code, targetId)) || "???";
      io.to(code).emit("uno:uno-penalty", targetId, targetName);
    }
    await sendUnoTurnToPlayers(io, code);
  });

  socket.on("uno:next-round", async () => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isUnoGame(code))) return;

    const result = await advanceUnoRound(code);
    if (result.gameOver) {
      const scores = await getUnoScores(code);
      io.to(code).emit("uno:game-over", scores);
      recordUnoGameResult(code, scores);
      return;
    }
    if (result.started) {
      await sendUnoTurnToPlayers(io, code);
      triggerUnoBotTurn(io, code);
      scheduleUnoTurnTimer(code, (c) => handleTurnTimeout(io, c));
    }
  });
}
