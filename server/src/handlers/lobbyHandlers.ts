import type { Server, Socket } from "socket.io";
import type { ClientEvents, ServerEvents, UnoDeckTemplate } from "../types.js";
import {
  createLobby, joinLobby, leaveLobby, startGame, joinAsSpectator,
  changeLobbyDeck, addBot, removeBot, kickPlayer, voteRematch,
  resetLobbyForRematch, setLobbyHouseRules, setMaxPlayers,
  getLobbyForSocket, getLobbyDeckId, getLobbyDeckName, getLobbyGameType,
  getLobbyHouseRules, getActivePlayers, getPlayerNameInLobby, getLobbyPlayers,
} from "../lobby.js";
import { getDeck } from "../deckStore.js";
import { createGame, startRound, getPlayerView, getScores, endGame, cleanupGame, addPlayerToGame, removePlayerFromGame } from "../game.js";
import { createUnoGame, isUnoGame, cleanupUnoGame, getUnoPlayerView, removePlayerFromUnoGame, setUnoPlayerNames } from "../unoGame.js";
import { createCodenamesGame, isCodenamesGame, cleanupCodenamesGame, getCodenamesPlayerView, removePlayerFromCodenamesGame } from "../codenamesGame.js";
import { setInGame, setNotInGame, getUserIdForSocket } from "../presence.js";
import pool from "../db.js";
import {
  findPlayerLobby, getPlayerName, clearChatHistory, getChatHistory,
  sendRoundToPlayers, sendUnoTurnToPlayers, sendCodenamesUpdate,
  clearRoundTimer, clearUnoTurnTimer, scheduleRoundTimer, scheduleUnoTurnTimer,
} from "../socketHelpers.js";
import { createLogger } from "../logger.js";
import { triggerBotActions, createCahTimerCallback } from "./cahHandlers.js";
import { triggerUnoBotTurn, createUnoTimerCallback } from "./unoHandlers.js";

const log = createLogger("lobby");

export async function handleLeave(io: Server<ClientEvents, ServerEvents>, socketId: string) {
  const leaverUserId = await getUserIdForSocket(socketId);
  if (leaverUserId) await setNotInGame(leaverUserId);

  const code = await getLobbyForSocket(socketId);
  const result = await leaveLobby(socketId);
  if (!result) return;

  if (code) {
    // Remove from whichever game engine owns this lobby so the leaver stops
    // receiving turn/round updates (which would otherwise force them back
    // onto the game screen via the client's uno:turn-update handler).
    removePlayerFromGame(code, socketId);
    removePlayerFromUnoGame(code, socketId);
    removePlayerFromCodenamesGame(code, socketId);
  }

  if (result.lobby) {
    io.to(result.code).emit("lobby:updated", result.lobby);
    io.to(result.code).emit("lobby:player-left", socketId);
    if (result.newHostId) io.to(result.code).emit("lobby:host-changed", result.newHostId);

    // Push refreshed game state so the remaining players see the leaver gone
    // from the turn rotation immediately, not on their next action.
    if (code) {
      if (isUnoGame(code)) sendUnoTurnToPlayers(io, code);
      else if (isCodenamesGame(code)) await sendCodenamesUpdate(io, code);
    }
  } else {
    cleanupGame(result.code);
    cleanupUnoGame(result.code);
    cleanupCodenamesGame(result.code);
    await clearChatHistory(result.code);
  }
}

// ── Socket Event Registration ────────────────────────────────────────────────

export function registerLobbyHandlers(
  io: Server<ClientEvents, ServerEvents>,
  socket: Socket<ClientEvents, ServerEvents>,
) {
  socket.on("lobby:create", async (playerName, deckId, callback) => {
    try {
      const safeName = (typeof playerName === "string" ? playerName : "Player").trim().slice(0, 30) || "Player";
      playerName = safeName;
      const deck = await getDeck(deckId);
      if (!deck) { callback({ success: false, error: "Deck not found" }); return; }

      const result = await createLobby(socket.id, playerName, deckId, deck.name, deck.gameType, deck.winCondition);
      if ("error" in result) { callback({ success: false, error: result.error }); return; }

      socket.join(result.lobby.code);
      callback({ success: true, lobby: result.lobby });

      const creatorUserId = await getUserIdForSocket(socket.id);
      if (creatorUserId) await setInGame(creatorUserId, result.lobby.code, deck.name);

      log.info("created", { code: result.lobby.code, host: playerName, deck: deck.name });
    } catch {
      callback({ success: false, error: "Server error" });
    }
  });

  socket.on("lobby:join", async (code, playerName, callback) => {
    playerName = (typeof playerName === "string" ? playerName : "Player").trim().slice(0, 30) || "Player";
    const result = await joinLobby(socket.id, code, playerName);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }

    socket.join(result.lobby.code);

    if (result.lobby.status === "playing") {
      addPlayerToGame(result.lobby.code, socket.id);
      const gameView = getPlayerView(result.lobby.code, socket.id);
      callback({ success: true, lobby: result.lobby });
      socket.to(result.lobby.code).emit("lobby:player-joined", result.player);
      io.to(result.lobby.code).emit("lobby:updated", result.lobby);
      if (gameView) {
        socket.emit("game:round-start", gameView);
        socket.emit("lobby:started");
      }
    } else {
      callback({ success: true, lobby: result.lobby });
      socket.to(result.lobby.code).emit("lobby:player-joined", result.player);
      socket.to(result.lobby.code).emit("lobby:updated", result.lobby);
    }

    const joinerUserId = await getUserIdForSocket(socket.id);
    if (joinerUserId) await setInGame(joinerUserId, result.lobby.code, result.lobby.deckName);
    log.info("player joined", { code, player: playerName });
  });

  socket.on("lobby:spectate" as any, async (code: string, playerName: string, callback: (response: { success: boolean; lobby?: any; error?: string }) => void) => {
    const result = await joinAsSpectator(socket.id, code, playerName);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }

    socket.join(result.lobby.code);
    callback({ success: true, lobby: result.lobby });
    socket.to(result.lobby.code).emit("lobby:player-joined", result.player);
    io.to(result.lobby.code).emit("lobby:updated", result.lobby);

    if (result.lobby.status === "playing") {
      const spectatorView = getPlayerView(result.lobby.code, socket.id);
      if (spectatorView) {
        socket.emit("game:round-start", { ...spectatorView, hand: [] });
        socket.emit("lobby:started");
      }
    }
    log.info("spectator joined", { code, player: playerName });
  });

  socket.on("lobby:leave", () => handleLeave(io, socket.id));

  socket.on("lobby:change-deck" as any, async (deckId: string, callback: (res: any) => void) => {
    try {
      const deck = await getDeck(deckId);
      if (!deck) { callback({ success: false, error: "Deck not found" }); return; }

      const result = await changeLobbyDeck(socket.id, deckId, deck.name, deck.gameType || "cah", deck.winCondition);
      if ("error" in result) { callback({ success: false, error: result.error }); return; }

      callback({ success: true, lobby: result.lobby });
      io.to(result.code).emit("lobby:updated", result.lobby);
      log.info("deck changed", { code: result.code, deck: deck.name });
    } catch (e: any) {
      callback({ success: false, error: e.message });
    }
  });

  socket.on("lobby:set-house-rules" as any, async (houseRules: { unoStacking?: boolean }, callback: (res: any) => void) => {
    const result = await setLobbyHouseRules(socket.id, houseRules);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }
    callback({ success: true });
    io.to(result.code).emit("lobby:updated", result.lobby);
  });

  socket.on("lobby:set-max-players" as any, async (maxPlayers: number, callback: (res: any) => void) => {
    const result = await setMaxPlayers(socket.id, maxPlayers);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }
    callback({ success: true });
    io.to(result.code).emit("lobby:updated", result.lobby);
  });

  socket.on("lobby:start", async (callback) => {
    try {
      const result = await startGame(socket.id);
      if ("error" in result) { callback({ success: false, error: result.error }); return; }

      const playerIds = await getActivePlayers(result.code);
      if (!playerIds || playerIds.length < 2) { callback({ success: false, error: "Not enough players" }); return; }

      const deckId = await getLobbyDeckId(result.code);
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
          if (gameType === "uno" && deck.chaosCards?.length > 0) {
            try {
              const raw = deck.chaosCards[0] as any;
              if (raw.colorNames) unoTemplate = raw as UnoDeckTemplate;
              else if (raw.text) {
                const parsed = JSON.parse(raw.text);
                if (parsed.colorNames) unoTemplate = parsed as UnoDeckTemplate;
              }
            } catch {}
          }
        }
      }

      callback({ success: true });

      if (deckId) {
        pool.query("UPDATE decks SET play_count = COALESCE(play_count, 0) + 1 WHERE id = $1", [deckId]).catch(() => {});
      }

      const code = result.code;
      io.to(code).emit("lobby:countdown" as any, 3);
      setTimeout(() => io.to(code).emit("lobby:countdown" as any, 2), 1000);
      setTimeout(() => io.to(code).emit("lobby:countdown" as any, 1), 2000);
      setTimeout(async () => {
        io.to(code).emit("lobby:countdown" as any, 0);

        if (gameType === "codenames") {
          const wordPool = (customKnowledge || []).map(c => c.text).filter(t => t.trim());
          if (wordPool.length < 25) {
            const defaults = ["Apple","Bank","Bark","Bear","Berlin","Board","Bond","Boot","Bowl","Bug","Canada","Card","Castle","Cat","Cell","Chair","Change","Chest","China","Clip","Cloud","Club","Code","Cold","Comet","Compound","Copper","Crane","Crash","Cricket","Cross","Crown","Cycle","Day","Death","Diamond","Dice","Doctor","Dog","Draft","Dragon","Dress","Drill","Drop","Duck","Dwarf","Eagle","Egypt","Engine","Eye","Fair","Fan","Field","File","Film","Fire","Fish","Fly","Force","Forest","Fork","France","Game","Gas","Ghost","Giant","Glass","Glove","Gold","Grass","Green","Ham","Hand","Hawk","Head","Heart","Himalayas","Hit","Hole","Hook","Horn","Horse","Hospital","Hotel","Ice","Iron","Ivory","Jack","Jam","Jet","Jupiter","Kangaroo","Ketchup","Key","Kid","King","Kite","Knight","Lab","Lap","Laser","Lead","Lemon","Life","Light","Limousine","Line","Link","Lion","Lock","Log","London","Luck","Mail","Mammoth","Maple","March","Mass","Match","Mercury","Mexico","Microscope","Milk","Mine","Model","Mole","Moon","Moscow","Mount","Mouse","Mud","Mug","Nail","Net","Night","Ninja","Note","Novel","Nurse","Nut","Octopus","Oil","Olive","Olympus","Opera","Orange","Organ","Palm","Pan","Pants","Paper","Park","Pass","Paste","Penguin","Phoenix","Piano","Pie","Pilot","Pin","Pipe","Pirate","Pistol","Pit","Plate","Play","Plot","Point","Poison","Pole","Pool","Port","Post","Press","Princess","Pumpkin","Pupil","Queen","Rabbit","Race","Radio","Rain","Ranch","Ray","Revolution","Ring","Robin","Robot","Rock","Rome","Root","Rose","Round","Row","Ruler","Russia","Sail","Sand","Saturn","Scale","School","Scientist","Screen","Seal","Server","Shadow","Shakespeare","Shark","Ship","Shoe","Shop","Shot","Silk","Singer","Sink","Slip","Slug","Smuggler","Snow","Soldier","Soul","Space","Spell","Spider","Spike","Spot","Spring","Spy","Square","Staff","Star","State","Steam","Steel","Stick","Stock","Storm","Stream","Strike","String","Sub","Sugar","Suit","Super","Swan","Switch","Table","Tail","Tap","Teacher","Temple","Texas","Theater","Thief","Thumb","Tick","Tie","Tiger","Time","Tokyo","Tooth","Tower","Track","Train","Triangle","Trip","Trunk","Tube","Turkey","Undertaker","Unicorn","Vacuum","Van","Vet","Violet","Virus","Wall","War","Wash","Washington","Watch","Water","Wave","Web","Well","Whale","Whip","Wind","Witch","Worm","Yard"];
            wordPool.push(...defaults);
          }
          createCodenamesGame(code, playerIds, wordPool);
          io.to(code).emit("lobby:started");
          for (const pid of playerIds) {
            const view = getCodenamesPlayerView(code, pid);
            if (view) {
              const playerSocket = io.sockets.sockets.get(pid);
              if (playerSocket) playerSocket.emit("codenames:update" as any, view);
            }
          }
        } else if (gameType === "uno") {
          const template = unoTemplate || { colorNames: { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" } };
          const houseRules = await getLobbyHouseRules(code);
          createUnoGame(code, playerIds, template, winCondition, houseRules);
          // Push display names into unoGame so its lastAction strings use
          // real names instead of internal bot-hex IDs. lobby.ts is now
          // async and we avoid hitting it on every card play from
          // unoGame.ts (which is a pure engine module).
          const unoNames: Record<string, string> = {};
          for (const pid of playerIds) {
            const n = await getPlayerNameInLobby(code, pid);
            if (n) unoNames[pid] = n;
          }
          setUnoPlayerNames(code, unoNames);
          io.to(code).emit("lobby:started");
          sendUnoTurnToPlayers(io, code);
          triggerUnoBotTurn(io, code);
          scheduleUnoTurnTimer(code, createUnoTimerCallback(io));
        } else {
          createGame(code, playerIds, customChaos, customKnowledge, winCondition, gameType);
          const round = startRound(code);
          if (round) {
            io.to(code).emit("lobby:started");
            sendRoundToPlayers(io, code);
            triggerBotActions(io, code);
            scheduleRoundTimer(code, createCahTimerCallback(io));
          } else {
            const scores = getScores(code) || {};
            endGame(code);
            io.to(code).emit("game:over", scores);
          }
        }

        log.info("game started", { code, gameType: gameType || "cah" });
      }, 3000);
    } catch {
      callback({ success: false, error: "Server error" });
    }
  });

  socket.on("lobby:add-bot" as any, async (callback: (response: { success: boolean; lobby?: any; error?: string }) => void) => {
    const result = await addBot(socket.id);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }
    callback({ success: true, lobby: result.lobby });
    io.to(result.lobby.code).emit("lobby:updated", result.lobby);
    log.info("bot added", { code: result.lobby.code });
  });

  socket.on("lobby:remove-bot" as any, async (botId: string, callback: (response: { success: boolean; lobby?: any; error?: string }) => void) => {
    const result = await removeBot(socket.id, botId);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }
    io.to(result.lobby.code).emit("lobby:updated", result.lobby);
    callback({ success: true, lobby: result.lobby });
    log.info("bot removed", { botId });
  });

  socket.on("lobby:kick" as any, async (targetId: string, callback: (response: { success: boolean; error?: string }) => void) => {
    const result = await kickPlayer(socket.id, targetId);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }
    io.to(targetId).emit("lobby:kicked" as any);
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) targetSocket.leave(result.code);
    io.to(result.code).emit("lobby:updated", result.lobby);
    callback({ success: true });
    log.info("player kicked", { code: result.code, targetId });
  });

  socket.on("lobby:vote-rematch" as any, async (callback: (response: any) => void) => {
    const result = await voteRematch(socket.id);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }
    callback({ success: true, voteCount: result.voteCount, totalPlayers: result.totalPlayers });
    io.to(result.code).emit("lobby:updated", result.lobby);
    io.to(result.code).emit("lobby:rematch-vote" as any, {
      voterId: socket.id,
      voterName: await getPlayerNameInLobby(result.code, socket.id),
      voteCount: result.voteCount,
      totalPlayers: result.totalPlayers,
    });
  });

  socket.on("game:rematch" as any, async (callback: (response: { success: boolean; error?: string }) => void) => {
    const code = await findPlayerLobby(socket.id);
    if (!code) { callback({ success: false, error: "Not in a lobby" }); return; }

    clearRoundTimer(code);
    clearUnoTurnTimer(code);
    cleanupGame(code);
    cleanupUnoGame(code);
    cleanupCodenamesGame(code);

    const result = await resetLobbyForRematch(socket.id);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }

    callback({ success: true });
    io.to(result.code).emit("lobby:updated", result.lobby);
    io.to(result.code).emit("game:rematch" as any);
    log.info("rematch started", { code: result.code });
  });
}
