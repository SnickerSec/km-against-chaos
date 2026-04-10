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

function emitMetaEffect(
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

  io.to(code).emit("game:meta-effect", {
    effectType: effect.type,
    value: effect.value,
    affectedPlayerIds: targets,
    description,
  });
}

export function triggerBotActions(io: Server<ClientEvents, ServerEvents>, code: string) {
  const gt = getGameType(code);
  const phase = getCurrentPhase(code);
  if (gt === "joking_hazard" && phase === "czar_setup") {
    const czarId = getCzarId(code);
    if (czarId?.startsWith("bot-")) {
      setTimeout(() => {
        const result = botCzarSetup(code, czarId);
        if (result.success && result.czarSetupCard) {
          sendRoundToPlayers(io, code);
          scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
          triggerBotSubmissions(io, code);
        }
      }, 1500 + Math.random() * 1500);
      return;
    }
    return;
  }
  triggerBotSubmissions(io, code);
}

function triggerBotSubmissions(io: Server<ClientEvents, ServerEvents>, code: string) {
  const botIds = getBotsInLobby(code);
  const czarId = getCzarId(code);

  let delay = 1500;
  for (const botId of botIds) {
    if (botId === czarId) continue;
    setTimeout(() => {
      const result = botSubmitCards(code, botId);
      if (result.success) {
        io.to(code).emit("game:player-submitted", botId);
        if (result.allSubmitted) {
          const judgingData = getJudgingData(code);
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

function triggerBotCzarPick(io: Server<ClientEvents, ServerEvents>, code: string) {
  const czarId = getCzarId(code);
  if (!czarId?.startsWith("bot-")) return;

  setTimeout(() => {
    const result = botPickWinner(code, czarId);
    if (!result.winnerId) return;

    const scores = getScores(code);
    const winnerCards = getWinnerCards(code);
    const winnerName = getPlayerNameInLobby(code, result.winnerId);

    const audiencePick = getAudiencePick(code);
    io.to(code).emit("game:round-winner", result.winnerId, winnerName || "Unknown", winnerCards || [], scores || {}, audiencePick);

    if (result.metaEffect) {
      const { effect, winnerId: wId, czarId: cId, playerIds } = result.metaEffect;
      emitMetaEffect(io, code, effect, wId, cId, playerIds);
    }
  }, 8000 + Math.random() * 4000);
}

// ── Timer Expiry ─────────────────────────────────────────────────────────────

function handleTimerExpiry(io: Server<ClientEvents, ServerEvents>, code: string) {
  const czarId = getCzarId(code);
  const gt = getGameType(code);

  if (gt === "joking_hazard") {
    const setupCard = forceCzarSetup(code);
    if (setupCard) {
      sendRoundToPlayers(io, code);
      scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
      triggerBotSubmissions(io, code);
      return;
    }
  }

  const forced = forceSubmitForMissing(code);
  if (forced.length > 0) {
    for (const pid of forced) io.to(code).emit("game:player-submitted", pid);
    const judgingData = getJudgingData(code);
    if (judgingData) {
      io.to(code).emit("game:judging", judgingData.submissions, judgingData.chaosCard);
      scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
      triggerBotCzarPick(io, code);
    }
    return;
  }

  if (czarId) {
    const result = botPickWinner(code, czarId);
    if (result.winnerId) {
      const scores = getScores(code);
      const winnerCards = getWinnerCards(code);
      const winnerName = getPlayerNameInLobby(code, result.winnerId);
      const audiencePick = getAudiencePick(code);
      io.to(code).emit("game:round-winner", result.winnerId, winnerName || "Unknown", winnerCards || [], scores || {}, audiencePick);

      if (result.metaEffect) {
        const { effect, winnerId: wId, czarId: cId, playerIds } = result.metaEffect;
        emitMetaEffect(io, code, effect, wId, cId, playerIds);
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
  socket.on("game:czar-setup", (cardId, callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code) { callback({ success: false, error: "Not in a game" }); return; }

    clearRoundTimer(code);
    const result = czarSetup(code, socket.id, cardId);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    sendRoundToPlayers(io, code);
    triggerBotSubmissions(io, code);
    scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
  });

  socket.on("game:submit", (cardIds, callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code) { callback({ success: false, error: "Not in a game" }); return; }

    const result = submitCards(code, socket.id, cardIds);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    socket.to(code).emit("game:player-submitted", socket.id);

    if (result.allSubmitted) {
      const judgingData = getJudgingData(code);
      if (judgingData) {
        io.to(code).emit("game:judging", judgingData.submissions, judgingData.chaosCard);
        scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
        triggerBotCzarPick(io, code);
      }
    }
  });

  socket.on("game:pick-winner", (winnerId, callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code) { callback({ success: false, error: "Not in a game" }); return; }

    clearRoundTimer(code);
    const result = pickWinner(code, socket.id, winnerId);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });

    const scores = getScores(code);
    const winnerCards = getWinnerCards(code);
    const winnerName = getPlayerName(code, winnerId);
    const audiencePick = getAudiencePick(code);
    io.to(code).emit("game:round-winner", winnerId, winnerName || "Unknown", winnerCards || [], scores || {}, audiencePick);

    if (result.metaEffect) {
      const { effect, winnerId: wId, czarId, playerIds } = result.metaEffect;
      emitMetaEffect(io, code, effect, wId, czarId, playerIds);
    }
  });

  socket.on("game:spectator-vote", (votedForId, callback) => {
    const code = findPlayerLobby(socket.id);
    if (!code) { callback({ success: false, error: "Not in a game" }); return; }

    const result = spectatorVote(code, socket.id, votedForId);
    callback(result);
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
      sendRoundToPlayers(io, code);
      triggerBotActions(io, code);
      scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
    } else {
      const scores = getScores(code);
      endGame(code);
      io.to(code).emit("game:over", scores || {});
      recordCahGameResult(code, scores || {});
    }
  });
}
