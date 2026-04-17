import type { Server, Socket } from "socket.io";
import type { ClientEvents, ServerEvents } from "../types.js";
import {
  submitCards, pickWinner, getJudgingData, getWinnerCards,
  advanceRound, getScores, isGameOver, startRound, endGame,
  resolveMetaTargets, resetPlayerHand, botSubmitCards, botPickWinner,
  getCzarId, forceSubmitForMissing, czarSetup, botCzarSetup, forceCzarSetup,
  getGameType, getCurrentPhase, spectatorVote, getAudiencePick,
} from "../game.js";
import { getBotsInLobby, getPlayerNameInLobby } from "../lobby.js";
import {
  findPlayerLobby, getPlayerName, sendRoundToPlayers,
  scheduleRoundTimer, clearRoundTimer, recordCahGameResult,
} from "../socketHelpers.js";

// ── Bot Orchestration ────────────────────────────────────────────────────────

async function emitMetaEffect(
  io: Server<ClientEvents, ServerEvents>,
  code: string,
  effect: any,
  winnerId: string,
  czarId: string,
  playerIds: string[],
) {
  const targets = resolveMetaTargets(effect.target, winnerId, czarId, playerIds);

  if (effect.type === "hand_reset") {
    for (const pid of targets) {
      const newHand = await resetPlayerHand(code, pid);
      io.to(pid).emit("game:hand-updated", newHand);
    }
  }

  const affectedNames = await Promise.all(
    targets.map(async (pid: string) => (await getPlayerNameInLobby(code, pid)) || "???")
  );
  let description = "";
  switch (effect.type) {
    case "score_add": description = `+${effect.value} point${effect.value !== 1 ? "s" : ""} for ${affectedNames.join(", ")}`; break;
    case "score_subtract": description = `-${effect.value} point${effect.value !== 1 ? "s" : ""} from ${affectedNames.join(", ")}`; break;
    case "hide_cards": description = `${affectedNames.join(", ")}'s cards are hidden for ${Math.round((effect.durationMs || 20000) / 1000)}s`; break;
    case "randomize_icons": description = `Icons randomized for ${affectedNames.join(", ")} for ${Math.round((effect.durationMs || 15000) / 1000)}s`; break;
    case "hand_reset": description = `${affectedNames.join(", ")} drew a fresh hand`; break;
  }

  io.to(code).emit("game:meta-effect", {
    effectType: effect.type,
    value: effect.value,
    affectedPlayerIds: targets,
    description,
  });
}

export async function triggerBotActions(io: Server<ClientEvents, ServerEvents>, code: string) {
  const gt = await getGameType(code);
  const phase = await getCurrentPhase(code);
  if (gt === "joking_hazard" && phase === "czar_setup") {
    const czarId = await getCzarId(code);
    if (czarId?.startsWith("bot-")) {
      setTimeout(async () => {
        const result = await botCzarSetup(code, czarId);
        if (result.success && result.czarSetupCard) {
          await sendRoundToPlayers(io, code);
          await scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
          triggerBotSubmissions(io, code);
        }
      }, 1500 + Math.random() * 1500);
      return;
    }
    return;
  }
  triggerBotSubmissions(io, code);
}

async function triggerBotSubmissions(io: Server<ClientEvents, ServerEvents>, code: string) {
  const botIds = await getBotsInLobby(code);
  const czarId = await getCzarId(code);

  let delay = 1500;
  for (const botId of botIds) {
    if (botId === czarId) continue;
    setTimeout(async () => {
      const result = await botSubmitCards(code, botId);
      if (result.success) {
        io.to(code).emit("game:player-submitted", botId);
        if (result.allSubmitted) {
          const judgingData = await getJudgingData(code);
          if (judgingData) {
            io.to(code).emit("game:judging", judgingData.submissions, judgingData.chaosCard);
            triggerBotCzarPick(io, code);
          }
        }
      }
    }, delay);
    delay += 800 + Math.random() * 1200;
  }
}

async function triggerBotCzarPick(io: Server<ClientEvents, ServerEvents>, code: string) {
  const czarId = await getCzarId(code);
  if (!czarId?.startsWith("bot-")) return;

  setTimeout(async () => {
    const result = await botPickWinner(code, czarId);
    if (!result.winnerId) return;

    const scores = await getScores(code);
    const winnerCards = await getWinnerCards(code);
    const winnerName = await getPlayerNameInLobby(code, result.winnerId);

    const audiencePick = await getAudiencePick(code);
    io.to(code).emit("game:round-winner", result.winnerId, winnerName || "Unknown", winnerCards || [], scores || {}, audiencePick);

    if (result.metaEffect) {
      const { effect, winnerId: wId, czarId: cId, playerIds } = result.metaEffect;
      await emitMetaEffect(io, code, effect, wId, cId, playerIds);
    }
  }, 8000 + Math.random() * 4000);
}

// ── Timer Expiry ─────────────────────────────────────────────────────────────

async function handleTimerExpiry(io: Server<ClientEvents, ServerEvents>, code: string) {
  const czarId = await getCzarId(code);
  const gt = await getGameType(code);

  if (gt === "joking_hazard") {
    const setupCard = await forceCzarSetup(code);
    if (setupCard) {
      await sendRoundToPlayers(io, code);
      await scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
      triggerBotSubmissions(io, code);
      return;
    }
  }

  const forced = await forceSubmitForMissing(code);
  if (forced.length > 0) {
    for (const pid of forced) io.to(code).emit("game:player-submitted", pid);
    const judgingData = await getJudgingData(code);
    if (judgingData) {
      io.to(code).emit("game:judging", judgingData.submissions, judgingData.chaosCard);
      await scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
      triggerBotCzarPick(io, code);
    }
    return;
  }

  if (czarId) {
    const result = await botPickWinner(code, czarId);
    if (result.winnerId) {
      const scores = await getScores(code);
      const winnerCards = await getWinnerCards(code);
      const winnerName = await getPlayerNameInLobby(code, result.winnerId);
      const audiencePick = await getAudiencePick(code);
      io.to(code).emit("game:round-winner", result.winnerId, winnerName || "Unknown", winnerCards || [], scores || {}, audiencePick);

      if (result.metaEffect) {
        const { effect, winnerId: wId, czarId: cId, playerIds } = result.metaEffect;
        await emitMetaEffect(io, code, effect, wId, cId, playerIds);
      }
    }
  }
}

/** Factory: returns a timer-expiry callback bound to this io instance. */
export function createCahTimerCallback(io: Server<ClientEvents, ServerEvents>) {
  return (code: string) => handleTimerExpiry(io, code);
}

// ── Socket Event Registration ────────────────────────────────────────────────

export function registerCahHandlers(
  io: Server<ClientEvents, ServerEvents>,
  socket: Socket<ClientEvents, ServerEvents>,
) {
  socket.on("game:czar-setup", async (cardId, callback) => {
    const code = await findPlayerLobby(socket.id);
    if (!code) { callback({ success: false, error: "Not in a game" }); return; }

    clearRoundTimer(code);
    const result = await czarSetup(code, socket.id, cardId);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendRoundToPlayers(io, code);
    triggerBotSubmissions(io, code);
    await scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
  });

  socket.on("game:submit", async (cardIds, callback) => {
    const code = await findPlayerLobby(socket.id);
    if (!code) { callback({ success: false, error: "Not in a game" }); return; }

    const result = await submitCards(code, socket.id, cardIds);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    socket.to(code).emit("game:player-submitted", socket.id);

    if (result.allSubmitted) {
      const judgingData = await getJudgingData(code);
      if (judgingData) {
        io.to(code).emit("game:judging", judgingData.submissions, judgingData.chaosCard);
        await scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
        triggerBotCzarPick(io, code);
      }
    }
  });

  socket.on("game:pick-winner", async (winnerId, callback) => {
    const code = await findPlayerLobby(socket.id);
    if (!code) { callback({ success: false, error: "Not in a game" }); return; }

    clearRoundTimer(code);
    const result = await pickWinner(code, socket.id, winnerId);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });

    const scores = await getScores(code);
    const winnerCards = await getWinnerCards(code);
    const winnerName = await getPlayerName(code, winnerId);
    const audiencePick = await getAudiencePick(code);
    io.to(code).emit("game:round-winner", winnerId, winnerName || "Unknown", winnerCards || [], scores || {}, audiencePick);

    if (result.metaEffect) {
      const { effect, winnerId: wId, czarId, playerIds } = result.metaEffect;
      await emitMetaEffect(io, code, effect, wId, czarId, playerIds);
    }
  });

  socket.on("game:spectator-vote", async (votedForId, callback) => {
    const code = await findPlayerLobby(socket.id);
    if (!code) { callback({ success: false, error: "Not in a game" }); return; }

    const result = await spectatorVote(code, socket.id, votedForId);
    callback(result);
  });

  socket.on("game:next-round", async () => {
    const code = await findPlayerLobby(socket.id);
    if (!code) return;

    await advanceRound(code);

    if (await isGameOver(code)) {
      const scores = await getScores(code);
      await endGame(code);
      io.to(code).emit("game:over", scores || {});
      recordCahGameResult(code, scores || {});
      return;
    }

    const round = await startRound(code);
    if (round) {
      await sendRoundToPlayers(io, code);
      await triggerBotActions(io, code);
      await scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
    } else {
      const scores = await getScores(code);
      await endGame(code);
      io.to(code).emit("game:over", scores || {});
      recordCahGameResult(code, scores || {});
    }
  });
}
