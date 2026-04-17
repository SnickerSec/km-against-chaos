import type { Server, Socket } from "socket.io";
import type { ClientEvents, ServerEvents } from "../types.js";
import { joinTeam, startCodenamesRound, giveClue, guessWord, passTurn, isCodenamesGame, getCodenamesScores } from "../codenamesGame.js";
import { findPlayerLobby, sendCodenamesUpdate } from "../socketHelpers.js";

export function registerCodenamesHandlers(
  io: Server<ClientEvents, ServerEvents>,
  socket: Socket<ClientEvents, ServerEvents>,
) {
  socket.on("codenames:join-team" as any, async (team: string, asSpymaster: boolean, callback: (res: any) => void) => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isCodenamesGame(code))) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = await joinTeam(code, socket.id, team as any, asSpymaster);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendCodenamesUpdate(io, code);
  });

  socket.on("codenames:start-round" as any, async (callback: (res: any) => void) => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isCodenamesGame(code))) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = await startCodenamesRound(code);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendCodenamesUpdate(io, code);
  });

  socket.on("codenames:give-clue" as any, async (word: string, count: number, callback: (res: any) => void) => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isCodenamesGame(code))) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = await giveClue(code, socket.id, word, count);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendCodenamesUpdate(io, code);
  });

  socket.on("codenames:guess" as any, async (wordIndex: number, callback: (res: any) => void) => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isCodenamesGame(code))) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = await guessWord(code, socket.id, wordIndex);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true, color: result.color, gameOver: result.gameOver, turnOver: result.turnOver });
    await sendCodenamesUpdate(io, code);

    if (result.gameOver) {
      const scores = await getCodenamesScores(code);
      if (scores) io.to(code).emit("game:over", scores);
    }
  });

  socket.on("codenames:pass" as any, async (callback: (res: any) => void) => {
    const code = await findPlayerLobby(socket.id);
    if (!code || !(await isCodenamesGame(code))) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = await passTurn(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    await sendCodenamesUpdate(io, code);
  });
}
