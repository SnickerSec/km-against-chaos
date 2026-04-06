import type { Server, Socket } from "socket.io";
import type { ClientEvents, ServerEvents } from "../types.js";
import { joinTeam, startCodenamesRound, giveClue, guessWord, passTurn, isCodenamesGame, getCodenamesScores } from "../codenamesGame.js";
import { findPlayerLobby, sendCodenamesUpdate } from "../socketHelpers.js";

export function registerCodenamesHandlers(
  io: Server<ClientEvents, ServerEvents>,
  socket: Socket<ClientEvents, ServerEvents>,
) {
  socket.on("codenames:join-team" as any, (team: string, asSpymaster: boolean, callback: (res: any) => void) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isCodenamesGame(code)) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = joinTeam(code, socket.id, team as any, asSpymaster);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    sendCodenamesUpdate(io, code);
  });

  socket.on("codenames:start-round" as any, (callback: (res: any) => void) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isCodenamesGame(code)) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = startCodenamesRound(code);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    sendCodenamesUpdate(io, code);
  });

  socket.on("codenames:give-clue" as any, (word: string, count: number, callback: (res: any) => void) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isCodenamesGame(code)) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = giveClue(code, socket.id, word, count);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    sendCodenamesUpdate(io, code);
  });

  socket.on("codenames:guess" as any, (wordIndex: number, callback: (res: any) => void) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isCodenamesGame(code)) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = guessWord(code, socket.id, wordIndex);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true, color: result.color, gameOver: result.gameOver, turnOver: result.turnOver });
    sendCodenamesUpdate(io, code);

    if (result.gameOver) {
      const scores = getCodenamesScores(code);
      if (scores) io.to(code).emit("game:over", scores);
    }
  });

  socket.on("codenames:pass" as any, (callback: (res: any) => void) => {
    const code = findPlayerLobby(socket.id);
    if (!code || !isCodenamesGame(code)) { callback({ success: false, error: "Not in a Codenames game" }); return; }

    const result = passTurn(code, socket.id);
    if (!result.success) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    sendCodenamesUpdate(io, code);
  });
}
