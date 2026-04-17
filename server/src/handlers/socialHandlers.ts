import { randomBytes } from "crypto";
import type { Server, Socket } from "socket.io";
import type { ClientEvents, ServerEvents } from "../types.js";
import { verifyJwt } from "../auth.js";
import pool from "../db.js";
import { setOnline, getUserIdForSocket, getSocketIdsForUser } from "../presence.js";
import { createParty, joinParty, leaveParty, getPartyForUser, getPartySocketRoom } from "../party.js";
import { createLobby, getLobbyForSocket, getLobbyDeckName, getLobbyGameType, getPlayerNameInLobby } from "../lobby.js";
import { getDeck } from "../deckStore.js";
import { setInGame } from "../presence.js";
import {
  findPlayerLobby, getPlayerName, getVoiceUsers, removeFromVoice,
  addChatMessage, isAllowedMediaUrl,
} from "../socketHelpers.js";

export function registerSocialHandlers(
  io: Server<ClientEvents, ServerEvents>,
  socket: Socket<ClientEvents, ServerEvents>,
) {
  // ── Auth-Socket Bridge ──

  socket.on("auth:identify" as any, async (token: string, callback?: (res: any) => void) => {
    try {
      const user = verifyJwt(token);
      await setOnline(user.id, socket.id);

      const friends = await pool.query(
        `SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END as friend_id
         FROM friendships f WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'`,
        [user.id]
      );
      for (const row of friends.rows) {
        const friendSockets = await getSocketIdsForUser(row.friend_id);
        for (const sid of friendSockets) {
          io.to(sid).emit("friend:online" as any, { userId: user.id, name: user.name });
        }
      }
      callback?.({ success: true });
    } catch {
      callback?.({ success: false, error: "Invalid token" });
    }
  });

  // ── Friends Real-time Events ──

  socket.on("invite:send" as any, async (targetUserId: string, callback?: (res: any) => void): Promise<void> => {
    const userId = await getUserIdForSocket(socket.id);
    if (!userId) { callback?.({ success: false, error: "Not authenticated" }); return; }

    const friendship = await pool.query(
      "SELECT 1 FROM friendships WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)) AND status = 'accepted' LIMIT 1",
      [userId, targetUserId]
    );
    if (friendship.rows.length === 0) { callback?.({ success: false, error: "Not friends" }); return; }

    const code = await getLobbyForSocket(socket.id);
    if (!code) { callback?.({ success: false, error: "Not in a lobby" }); return; }

    const deckName = (await getLobbyDeckName(code)) || "Unknown";
    const gameType = (await getLobbyGameType(code)) || "cah";
    const senderName = (await getPlayerNameInLobby(code, socket.id)) || "Someone";

    const targetSockets = await getSocketIdsForUser(targetUserId);
    for (const sid of targetSockets) {
      io.to(sid).emit("invite:received" as any, {
        fromUserId: userId, fromName: senderName, lobbyCode: code, deckName, gameType,
      });
    }

    const { createNotification } = await import("../notifications.js");
    await createNotification(targetUserId, "game_invite", { fromName: senderName, fromUserId: userId, deckName, lobbyCode: code });

    callback?.({ success: true });
  });

  socket.on("dm:send" as any, async (targetUserId: string, content: string, callback?: (res: any) => void) => {
    const userId = await getUserIdForSocket(socket.id);
    if (!userId) { callback?.({ success: false, error: "Not authenticated" }); return; }
    if (!content?.trim()) { callback?.({ success: false, error: "Empty message" }); return; }

    const friendship = await pool.query(
      "SELECT 1 FROM friendships WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)) AND status = 'accepted' LIMIT 1",
      [userId, targetUserId]
    );
    if (friendship.rows.length === 0) { callback?.({ success: false, error: "Not friends" }); return; }

    try {
      const trimmed = content.trim().slice(0, 2000);
      const id = randomBytes(8).toString("hex");
      await pool.query(
        "INSERT INTO direct_messages (id, sender_id, receiver_id, content) VALUES ($1, $2, $3, $4)",
        [id, userId, targetUserId, trimmed]
      );

      const senderRow = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
      const senderName = senderRow.rows[0]?.name || "Someone";

      const msg = { id, sender_id: userId, senderName, receiver_id: targetUserId, content: trimmed, created_at: new Date().toISOString(), read_at: null };
      const targetSockets = await getSocketIdsForUser(targetUserId);
      for (const sid of targetSockets) io.to(sid).emit("dm:received" as any, msg);
      callback?.({ success: true, message: msg });
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  socket.on("dm:typing" as any, async (targetUserId: string) => {
    const userId = await getUserIdForSocket(socket.id);
    if (!userId) return;
    const targetSockets = await getSocketIdsForUser(targetUserId);
    for (const sid of targetSockets) io.to(sid).emit("dm:typing" as any, { userId });
  });

  // ── Party Events ──

  socket.on("party:create" as any, async (callback: (res: any) => void) => {
    const userId = await getUserIdForSocket(socket.id);
    if (!userId) { callback({ success: false, error: "Not authenticated" }); return; }

    const userRow = await pool.query("SELECT name, picture FROM users WHERE id = $1", [userId]);
    const { name, picture } = userRow.rows[0] || { name: "Player", picture: "" };

    const result = createParty(userId, socket.id, name, picture);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }

    socket.join(getPartySocketRoom(result.id));
    callback({ success: true, party: result });
  });

  socket.on("party:invite" as any, async (targetUserId: string, callback?: (res: any) => void) => {
    const userId = await getUserIdForSocket(socket.id);
    if (!userId) { callback?.({ success: false, error: "Not authenticated" }); return; }

    const party = getPartyForUser(userId);
    if (!party) { callback?.({ success: false, error: "Not in a party" }); return; }
    if (party.leaderId !== userId) { callback?.({ success: false, error: "Only the leader can invite" }); return; }

    const leaderName = party.members.find(m => m.userId === userId)?.name || "Someone";
    const targetSockets = await getSocketIdsForUser(targetUserId);
    for (const sid of targetSockets) {
      io.to(sid).emit("party:invite" as any, { partyId: party.id, fromName: leaderName, fromUserId: userId });
    }
    callback?.({ success: true });
  });

  socket.on("party:join" as any, async (partyId: string, callback: (res: any) => void) => {
    const userId = await getUserIdForSocket(socket.id);
    if (!userId) { callback({ success: false, error: "Not authenticated" }); return; }

    const userRow = await pool.query("SELECT name, picture FROM users WHERE id = $1", [userId]);
    const { name, picture } = userRow.rows[0] || { name: "Player", picture: "" };

    const result = joinParty(partyId, userId, socket.id, name, picture);
    if ("error" in result) { callback({ success: false, error: result.error }); return; }

    const room = getPartySocketRoom(partyId);
    socket.join(room);
    io.to(room).emit("party:updated" as any, result);
    callback({ success: true, party: result });
  });

  socket.on("party:leave" as any, async (callback?: (res: any) => void) => {
    const userId = await getUserIdForSocket(socket.id);
    if (!userId) { callback?.({ success: false, error: "Not authenticated" }); return; }

    const result = leaveParty(userId);
    if ("error" in result) { callback?.({ success: false, error: result.error }); return; }

    const room = getPartySocketRoom(result.partyId);
    socket.leave(room);
    if (result.disbanded) {
      io.to(room).emit("party:disbanded" as any);
    } else if (result.party) {
      io.to(room).emit("party:updated" as any, result.party);
    }
    callback?.({ success: true });
  });

  socket.on("party:start-game" as any, async (deckId: string, callback: (res: any) => void) => {
    const userId = await getUserIdForSocket(socket.id);
    if (!userId) { callback({ success: false, error: "Not authenticated" }); return; }

    const party = getPartyForUser(userId);
    if (!party) { callback({ success: false, error: "Not in a party" }); return; }
    if (party.leaderId !== userId) { callback({ success: false, error: "Only the leader can start" }); return; }

    const deck = await getDeck(deckId);
    if (!deck) { callback({ success: false, error: "Deck not found" }); return; }

    const leaderName = party.members.find(m => m.userId === userId)?.name || "Player";
    const lobbyResult = await createLobby(socket.id, leaderName, deckId, deck.name, deck.gameType, deck.winCondition);
    if ("error" in lobbyResult) { callback({ success: false, error: lobbyResult.error }); return; }

    const lobbyCode = lobbyResult.lobby.code;
    socket.join(lobbyCode);
    if (userId) await setInGame(userId, lobbyCode, deck.name);

    const room = getPartySocketRoom(party.id);
    io.to(room).emit("party:game-starting" as any, { lobbyCode, deckName: deck.name });

    callback({ success: true, lobby: lobbyResult.lobby });
  });

  // ── Voice Chat Signaling ──

  socket.on("voice:join", async (callback) => {
    const code = await getLobbyForSocket(socket.id);
    if (!code) return;

    const users = getVoiceUsers(code);
    users.add(socket.id);

    const name = (await getPlayerName(code, socket.id)) || "???";
    socket.to(code).emit("voice:user-joined", { id: socket.id, name });

    const existing = await Promise.all(Array.from(users)
      .filter(id => id !== socket.id)
      .map(async id => ({ id, name: (await getPlayerName(code, id)) || "???" })));
    callback({ voiceUsers: existing });
  });

  socket.on("voice:leave", () => removeFromVoice(io, socket.id));

  socket.on("voice:offer", async (targetId, sdp) => {
    const senderCode = await getLobbyForSocket(socket.id);
    const targetCode = await getLobbyForSocket(targetId);
    if (!senderCode || senderCode !== targetCode) return;
    io.to(targetId).emit("voice:offer", socket.id, sdp);
  });

  socket.on("voice:answer", async (targetId, sdp) => {
    const senderCode = await getLobbyForSocket(socket.id);
    const targetCode = await getLobbyForSocket(targetId);
    if (!senderCode || senderCode !== targetCode) return;
    io.to(targetId).emit("voice:answer", socket.id, sdp);
  });

  socket.on("voice:ice-candidate", async (targetId, candidate) => {
    const senderCode = await getLobbyForSocket(socket.id);
    const targetCode = await getLobbyForSocket(targetId);
    if (!senderCode || senderCode !== targetCode) return;
    io.to(targetId).emit("voice:ice-candidate", socket.id, candidate);
  });

  // ── Reactions ──

  const reactionCooldowns = new Map<string, number>();

  socket.on("reaction:send", async (emoji) => {
    const code = await findPlayerLobby(socket.id);
    if (!code) return;

    const now = Date.now();
    const last = reactionCooldowns.get(socket.id) || 0;
    if (now - last < 500) return;
    reactionCooldowns.set(socket.id, now);

    if (!emoji || emoji.length > 2) return;
    const playerName = (await getPlayerName(code, socket.id)) || "???";
    io.to(code).emit("reaction:broadcast", emoji, playerName);
  });

  // ── Chat ──

  const chatCooldowns = new Map<string, number>();

  socket.on("chat:send", async (message) => {
    const code = await findPlayerLobby(socket.id);
    if (!code) return;

    const now = Date.now();
    const last = chatCooldowns.get(socket.id) || 0;
    if (now - last < 300) return;
    chatCooldowns.set(socket.id, now);

    if (!message || typeof message !== "string") return;
    const text = message.trim().slice(0, 200);
    if (text.length === 0) return;

    const playerName = (await getPlayerName(code, socket.id)) || "???";
    const msg = { id: `${socket.id}-${now}`, playerName, text, timestamp: now };
    await addChatMessage(code, msg);
    io.to(code).emit("chat:message", msg);
  });

  let lastGifTime = 0;
  socket.on("chat:gif", async (gifUrl: string) => {
    const now = Date.now();
    if (now - lastGifTime < 1000) return;
    lastGifTime = now;
    if (typeof gifUrl !== "string" || !isAllowedMediaUrl(gifUrl)) return;
    const code = await getLobbyForSocket(socket.id);
    const playerName = await getPlayerNameInLobby(code || "", socket.id);
    if (!code || !playerName) return;
    const msg = { id: `${Date.now()}-${Math.random()}`, playerName, text: "", gifUrl, timestamp: Date.now() };
    await addChatMessage(code, msg);
    io.to(code).emit("chat:message", msg);
  });

  let lastStickerTime = 0;
  socket.on("media:sticker", async (url: string) => {
    const now = Date.now();
    if (now - lastStickerTime < 2000) return;
    lastStickerTime = now;
    if (typeof url !== "string" || !isAllowedMediaUrl(url)) return;
    const code = await getLobbyForSocket(socket.id);
    const playerName = await getPlayerNameInLobby(code || "", socket.id);
    if (!code || !playerName) return;
    io.to(code).emit("media:sticker", url, playerName);
  });

  let lastSoundTime = 0;
  socket.on("sound:play" as any, async ({ mp3, title }: { mp3: string; title: string }) => {
    const now = Date.now();
    if (now - lastSoundTime < 3000) return;
    lastSoundTime = now;
    if (typeof mp3 !== "string" || (!mp3.startsWith("https://www.myinstants.com/") && !mp3.startsWith("/api/sounds/file/"))) return;
    const code = await getLobbyForSocket(socket.id);
    const playerName = await getPlayerNameInLobby(code || "", socket.id);
    if (!code || !playerName) return;
    io.to(code).emit("sound:received" as any, { mp3, title, playerName });
  });
}
