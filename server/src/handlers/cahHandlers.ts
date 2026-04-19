import type { Server, Socket } from "socket.io";
import type { ClientEvents, ServerEvents } from "../types.js";
import {
  submitCards, pickWinner, getJudgingData, getWinnerCards,
  advanceRound, getScores, isGameOver, startRound, endGame,
  resolveMetaTargets, resetPlayerHand, botSubmitCards, botPickWinner,
  getCzarId, forceSubmitForMissing, czarSetup, botCzarSetup, forceCzarSetup,
  getGameType, getCurrentPhase, spectatorVote, getAudiencePick,
  isBotCzarMode, tallyVotesAndPick,
} from "../game.js";
import { getBotsInLobby, getPlayerNameInLobby } from "../lobby.js";
import {
  findPlayerLobby, getPlayerName, sendRoundToPlayers,
  scheduleRoundTimer, clearRoundTimer, recordCahGameResult,
} from "../socketHelpers.js";
import { createLogger } from "../logger.js";

const log = createLogger("cah");

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
            kickoffJudging(io, code);
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

/** Bot-czar judging: non-czar bots auto-vote (random) so the round can
 *  resolve even if no humans are around. Each vote triggers the same
 *  early-tally check that human votes do. */
async function triggerBotVotes(io: Server<ClientEvents, ServerEvents>, code: string) {
  const judgingData = await getJudgingData(code);
  if (!judgingData) return;

  const submitters = judgingData.submissions.map((s) => s.playerId);
  if (submitters.length === 0) return;

  const botIds = await getBotsInLobby(code);
  const czarId = await getCzarId(code);

  let delay = 2000;
  for (const botId of botIds) {
    if (botId === czarId) continue;
    setTimeout(async () => {
      const choice = submitters[Math.floor(Math.random() * submitters.length)];
      const result = await spectatorVote(code, botId, choice);
      if (result.success) {
        io.to(code).emit("game:player-voted" as any, botId);
        if (result.allPlayersVoted) {
          await resolveBotCzarRound(io, code);
        }
      }
    }, delay);
    delay += 600 + Math.random() * 800;
  }
}

/** Tally votes and emit the round winner. Idempotent — safe to call from
 *  the timer-expiry path AND from the early "everyone voted" path. The
 *  underlying tallyVotesAndPick is a no-op if the round isn't in judging. */
async function resolveBotCzarRound(io: Server<ClientEvents, ServerEvents>, code: string) {
  clearRoundTimer(code);
  const result = await tallyVotesAndPick(code);
  if (!result.winnerId) return;

  const scores = await getScores(code);
  const winnerCards = await getWinnerCards(code);
  const winnerName = await getPlayerNameInLobby(code, result.winnerId);

  io.to(code).emit("game:round-winner", result.winnerId, winnerName || "Unknown", winnerCards || [], scores || {}, null);
  // Surface the tally so the client can show a leaderboard if it wants.
  io.to(code).emit("game:vote-tally" as any, result.votes || {});

  if (result.metaEffect) {
    const { effect, winnerId: wId, czarId: cId, playerIds } = result.metaEffect;
    await emitMetaEffect(io, code, effect, wId, cId, playerIds);
  }
}

/** Decide between the classic bot-judge flow and the bot-czar vote flow. */
async function kickoffJudging(io: Server<ClientEvents, ServerEvents>, code: string) {
  if (await isBotCzarMode(code)) {
    triggerBotVotes(io, code);
  } else {
    triggerBotCzarPick(io, code);
  }
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
    log.info("force-submit", { code, missing: forced });
    for (const pid of forced) {
      io.to(code).emit("game:player-submitted", pid);
      // Direct-to-victim toast so players know why cards "just appeared".
      io.to(pid).emit("game:auto-submitted" as any);
    }
    const judgingData = await getJudgingData(code);
    if (judgingData) {
      io.to(code).emit("game:judging", judgingData.submissions, judgingData.chaosCard);
      await scheduleRoundTimer(code, (c) => handleTimerExpiry(io, c));
      kickoffJudging(io, code);
    }
    return;
  }

  // Already in judging — timer expired waiting for a decision. Bot-czar mode
  // tallies whatever votes came in (even none — falls back to random).
  if (await isBotCzarMode(code)) {
    await resolveBotCzarRound(io, code);
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
        kickoffJudging(io, code);
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
    callback({ success: result.success, error: result.error });
    if (!result.success) return;

    socket.to(code).emit("game:player-voted" as any, socket.id);
    // Bot-czar mode: tally + emit winner the moment all in-game players have
    // voted. Spectator votes still arrive within the judging window but don't
    // gate the resolution.
    if (result.allPlayersVoted && await isBotCzarMode(code)) {
      await resolveBotCzarRound(io, code);
    }
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
