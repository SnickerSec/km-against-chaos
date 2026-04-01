import pool from "./db.js";
import { randomBytes } from "crypto";
import type { Server } from "socket.io";
import { getSocketIdsForUser } from "./presence.js";
import webpush from "web-push";

function genId() { return randomBytes(8).toString("hex"); }

let io: Server | null = null;

// Configure VAPID keys
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails("https://decked.gg", VAPID_PUBLIC, VAPID_PRIVATE);
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC;
}

export function setIO(socketIO: Server) {
  io = socketIO;
}

const NOTIFICATION_TITLES: Record<string, string> = {
  friend_request: "New Friend Request",
  friend_accepted: "Friend Request Accepted",
  game_invite: "Game Invite",
};

function buildPushBody(type: string, data: Record<string, any>): string {
  switch (type) {
    case "friend_request":
      return `${data.fromName} sent you a friend request`;
    case "friend_accepted":
      return `${data.fromName} accepted your friend request`;
    case "game_invite":
      return `${data.fromName} invited you to play ${data.deckName || "a game"}`;
    default:
      return "You have a new notification";
  }
}

export async function createNotification(
  userId: string,
  type: string,
  data: Record<string, any>
): Promise<{ id: string; type: string; data: Record<string, any>; read: boolean; created_at: string }> {
  const id = genId();
  const result = await pool.query(
    "INSERT INTO notifications (id, user_id, type, data) VALUES ($1, $2, $3, $4) RETURNING id, type, data, read, created_at",
    [id, userId, type, JSON.stringify(data)]
  );
  const notification = result.rows[0];

  // Emit real-time socket event
  if (io) {
    const sockets = getSocketIdsForUser(userId);
    for (const sid of sockets) {
      io.to(sid).emit("notification:new" as any, notification);
    }
  }

  // Send web push (fire and forget)
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    sendWebPush(userId, type, data).catch(() => {});
  }

  return notification;
}

async function sendWebPush(userId: string, type: string, data: Record<string, any>) {
  const subs = await pool.query("SELECT id, subscription FROM push_subscriptions WHERE user_id = $1", [userId]);

  const payload = JSON.stringify({
    title: NOTIFICATION_TITLES[type] || "Decked",
    body: buildPushBody(type, data),
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { type, ...data },
  });

  for (const row of subs.rows) {
    try {
      await webpush.sendNotification(row.subscription, payload);
    } catch (err: any) {
      // Remove expired/invalid subscriptions
      if (err.statusCode === 410 || err.statusCode === 404) {
        await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [row.id]);
      }
    }
  }
}
