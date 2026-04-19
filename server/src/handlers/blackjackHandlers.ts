import type { Server, Socket } from "socket.io";
import type { ClientEvents, ServerEvents } from "../types.js";
import {
  placeBet, sitOut, hit, stand, doubleDown, split,
  isBlackjackGame, runDealer, settleRound, startNextRound,
  getBlackjackScores, getBlackjackPlayerView,
} from "../blackjackGame.js";
import {
  findPlayerLobby, sendBlackjackUpdate, scheduleBlackjackTimer,
} from "../socketHelpers.js";

export function registerBlackjackHandlers(
  io: Server<ClientEvents, ServerEvents>,
  socket: Socket<ClientEvents, ServerEvents>,
) {
  const guard = async () => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isBlackjackGame(code))) return null;
    return code;
  };

  socket.on("blackjack:bet" as any, async (amount: number, callback: (res: any) => void) => {
    const code = await guard();
    if (!code) { callback({ success: false, error: "Not in a Blackjack game" }); return; }

    const result = await placeBet(code, socket.id, amount);
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
  const view = await getBlackjackPlayerView(code, "_observer_");
  if (!view) return;

  // Drive the dealer + settle phases automatically — they take no human input.
  if (view.phase === "dealer") {
    await runDealer(code);
    await sendBlackjackUpdate(io, code);
  }
  const v2 = await getBlackjackPlayerView(code, "_observer_");
  if (v2?.phase === "settle" && !v2.lastSettlement) {
    await settleRound(code);
    await sendBlackjackUpdate(io, code);
  }
  // Re-arm the timer for whatever phase we ended in. A no-op if no deadline
  // applies (e.g., gameOver).
  await scheduleBlackjackTimer(code, createBlackjackTimerCallback(io));

  const v3 = await getBlackjackPlayerView(code, "_observer_");
  if (v3?.phase === "gameOver") {
    const scores = await getBlackjackScores(code);
    if (scores) io.to(code).emit("game:over", scores);
  }
}
