import type { Server, Socket } from "socket.io";
import type { ClientEvents, ServerEvents } from "../types.js";
import {
  placeBet, sitOut, hit, stand, doubleDown, split, surrender,
  placeInsurance, declineInsurance,
  isBlackjackGame, runDealer, settleRound, startNextRound,
  getBlackjackScores, getBlackjackPlayerView,
  handleBettingTimeout, handleTurnTimeout, handleInsuranceTimeout,
  botPlaceBet, botPlayTurn,
} from "../blackjackGame.js";
import { getBotsInLobby } from "../lobby.js";
import {
  findPlayerLobby, sendBlackjackUpdate, scheduleBlackjackTimer,
} from "../socketHelpers.js";

const BOT_ACTION_DELAY_MS = 1200;

export function registerBlackjackHandlers(
  io: Server<ClientEvents, ServerEvents>,
  socket: Socket<ClientEvents, ServerEvents>,
) {
  const guard = async () => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isBlackjackGame(code))) return null;
    return code;
  };

  socket.on("blackjack:bet" as any, async (
    amount: number,
    sideBets: { perfectPairs?: number; twentyOnePlusThree?: number } | undefined,
    callback: (res: any) => void,
  ) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await placeBet(code, socket.id, amount, sideBets);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:sit-out" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await sitOut(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:hit" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await hit(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:stand" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await stand(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:double" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await doubleDown(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:split" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await split(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:surrender" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await surrender(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:insurance" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await placeInsurance(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });

  socket.on("blackjack:decline-insurance" as any, async (callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await declineInsurance(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendBlackjackUpdate(io, code);
    await afterMutation(io, code);
  });
}

/**
 * After any mutation, drive any phase auto-transitions and re-schedule the
 * timer for the new phaseDeadline. This is also the entry point the timer
 * fires into when a phase deadline expires (auto-bet / auto-stand / next-round).
 */
export function createBlackjackTimerCallback(
  io: Server<ClientEvents, ServerEvents>,
): (code: string) => void {
  return (code: string) => {
    void afterMutation(io, code);
  };
}

async function afterMutation(
  io: Server<ClientEvents, ServerEvents>,
  code: string,
): Promise<void> {
  // Drive any auto-transitions whose deadline has passed, in priority order.
  // The engine enforces its own phase guards, so these are all safe no-ops
  // when called on the wrong phase.
  //
  //   betting  + deadline passed → auto-sit-out null-bet players, deal
  //   playing  + deadline passed → auto-stand active hand
  //   dealer                      → run dealer
  //   settle   + no settlement    → settle
  //   settle   + deadline passed  → next round (or gameOver)
  //
  // Multiple transitions can chain within one afterMutation (e.g. betting
  // timeout → dealing → playing), so re-read the view after each step.

  const vBetting = await getBlackjackPlayerView(code, "_observer_");
  if (vBetting?.phase === "betting" && Date.now() >= vBetting.phaseDeadline) {
    await handleBettingTimeout(code);
    await sendBlackjackUpdate(io, code);
  }

  const vInsurance = await getBlackjackPlayerView(code, "_observer_");
  if (vInsurance?.phase === "insurance" && Date.now() >= vInsurance.phaseDeadline) {
    await handleInsuranceTimeout(code);
    await sendBlackjackUpdate(io, code);
  }

  const vPlaying = await getBlackjackPlayerView(code, "_observer_");
  if (vPlaying?.phase === "playing" && Date.now() >= vPlaying.phaseDeadline) {
    await handleTurnTimeout(code);
    await sendBlackjackUpdate(io, code);
  }

  const vDealer = await getBlackjackPlayerView(code, "_observer_");
  if (vDealer?.phase === "dealer") {
    await runDealer(code);
    await sendBlackjackUpdate(io, code);
  }

  const vSettle = await getBlackjackPlayerView(code, "_observer_");
  if (vSettle?.phase === "settle" && !vSettle.lastSettlement) {
    await settleRound(code);
    await sendBlackjackUpdate(io, code);
  }

  const vSettleDone = await getBlackjackPlayerView(code, "_observer_");
  if (vSettleDone?.phase === "settle" && vSettleDone.lastSettlement && Date.now() >= vSettleDone.phaseDeadline) {
    await startNextRound(code);
    await sendBlackjackUpdate(io, code);
  }

  // Re-arm the timer for the final phase.
  await scheduleBlackjackTimer(code, createBlackjackTimerCallback(io));

  // Kick bots if they owe an action in the new state.
  await triggerBlackjackBots(io, code);

  const vFinal = await getBlackjackPlayerView(code, "_observer_");
  if (vFinal?.phase === "gameOver") {
    const scores = await getBlackjackScores(code);
    if (scores) io.to(code).emit("game:over", scores);
  }
}

/**
 * Fire bot actions for whichever phase the table is in:
 *   - betting: every bot that hasn't bet places the min bet
 *   - playing: if the active player is a bot, it plays its hand
 *
 * Each bot action is delayed so the humans can see what's happening. The bot
 * action calls back into afterMutation, which advances the table and
 * re-triggers bots as needed.
 */
export async function triggerBlackjackBots(
  io: Server<ClientEvents, ServerEvents>,
  code: string,
): Promise<void> {
  const view = await getBlackjackPlayerView(code, "_observer_");
  if (!view) return;

  if (view.phase === "betting") {
    const botIds = (await getBotsInLobby(code)) || [];
    for (const botId of botIds) {
      if (view.bets[botId] !== null) continue;
      if (!view.playerIds.includes(botId)) continue;
      setTimeout(async () => {
        if (!(await isBlackjackGame(code))) return;
        const still = await getBlackjackPlayerView(code, "_observer_");
        if (still?.phase !== "betting" || still.bets[botId] !== null) return;
        await botPlaceBet(code, botId);
        await sendBlackjackUpdate(io, code);
        await afterMutation(io, code);
      }, BOT_ACTION_DELAY_MS);
    }
    return;
  }

  if (view.phase === "insurance") {
    // Insurance is a -EV bet unless you're counting, so bots always decline.
    // Fire all of them near-simultaneously so the phase resolves promptly.
    const botIds = (await getBotsInLobby(code)) || [];
    for (const botId of botIds) {
      if (view.insuranceDecisions?.[botId] !== null) continue;
      setTimeout(async () => {
        if (!(await isBlackjackGame(code))) return;
        const still = await getBlackjackPlayerView(code, "_observer_");
        if (still?.phase !== "insurance") return;
        if (still.insuranceDecisions?.[botId] !== null) return;
        await declineInsurance(code, botId);
        await sendBlackjackUpdate(io, code);
        await afterMutation(io, code);
      }, BOT_ACTION_DELAY_MS);
    }
    return;
  }

  if (view.phase === "playing" && view.activePlayerId) {
    const botIds = (await getBotsInLobby(code)) || [];
    const activeIsBot = botIds.includes(view.activePlayerId);
    if (!activeIsBot) return;
    const botId = view.activePlayerId;
    setTimeout(async () => {
      if (!(await isBlackjackGame(code))) return;
      const still = await getBlackjackPlayerView(code, "_observer_");
      if (still?.phase !== "playing" || still.activePlayerId !== botId) return;
      await botPlayTurn(code, botId);
      await sendBlackjackUpdate(io, code);
      await afterMutation(io, code);
    }, BOT_ACTION_DELAY_MS);
  }
}
