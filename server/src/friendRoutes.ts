import * as Sentry from "@sentry/node";
import { Router } from "express";
import { requireAuth } from "./auth.js";
import pool from "./db.js";
import { randomBytes } from "crypto";
import { getPresenceBulk } from "./presence.js";
import { createNotification, getVapidPublicKey } from "./notifications.js";

const router = Router();

const BODY_SIZE_LIMIT = 100 * 1024;

router.use((req, res, next) => {
  if (req.headers["content-type"]?.includes("application/json")) {
    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_SIZE_LIMIT) {
        res.status(413).json({ error: "Request body too large" });
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        (req as any).body = JSON.parse(body);
      } catch {
        (req as any).body = {};
      }
      next();
    });
  } else {
    (req as any).body = {};
    next();
  }
});

function genId() { return randomBytes(8).toString("hex"); }

const DM_MAX_LENGTH = 2000;
const NICKNAME_MAX_LENGTH = 50;

async function areFriends(userId: string, friendId: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM friendships WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)) AND status = 'accepted' LIMIT 1",
    [userId, friendId]
  );
  return result.rows.length > 0;
}

// List friends (accepted) and pending requests
router.get("/api/friends", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;

    const friends = await pool.query(`
      SELECT u.id, u.name, u.picture, u.last_seen, f.id as friendship_id, f.status, f.created_at, f.nickname,
             CASE WHEN f.user_id = $1 THEN 'sent' ELSE 'received' END as direction
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
      WHERE (f.user_id = $1 OR f.friend_id = $1)
      ORDER BY f.created_at DESC
    `, [userId]);

    // Attach presence info
    const friendIds = friends.rows.map((f: any) => f.id);
    const presenceMap = await getPresenceBulk(friendIds);
    const rows = friends.rows.map((f: any) => {
      const presence = presenceMap.get(f.id) || { status: "offline" };
      return { ...f, presence };
    });

    res.json(rows);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// Search users by name or email
router.get("/api/users/search", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const q = (req.query.q as string || "").trim();
    if (q.length < 2) return res.json([]);

    const results = await pool.query(`
      SELECT u.id, u.name, u.picture
      FROM users u
      WHERE u.id != $1
        AND (u.name ILIKE $2 OR u.email ILIKE $2)
        AND u.id NOT IN (
          SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
          FROM friendships f
          WHERE f.user_id = $1 OR f.friend_id = $1
        )
      ORDER BY u.name
      LIMIT 10
    `, [userId, `%${q}%`]);

    res.json(results.rows);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// Send friend request (by email)
router.post("/api/friends/request", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { email, userId: targetUserId } = req.body;

    let friendId: string;
    if (targetUserId) {
      // Direct user ID (from search results)
      const target = await pool.query("SELECT id FROM users WHERE id = $1", [targetUserId]);
      if (target.rows.length === 0) return res.status(404).json({ error: "User not found" });
      friendId = target.rows[0].id;
    } else if (email) {
      // Legacy email lookup
      const target = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
      if (target.rows.length === 0) return res.status(404).json({ error: "User not found" });
      friendId = target.rows[0].id;
    } else {
      return res.status(400).json({ error: "User ID or email required" });
    }
    if (friendId === userId) return res.status(400).json({ error: "Cannot add yourself" });

    // Check if friendship already exists (either direction)
    const existing = await pool.query(
      "SELECT id, status FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
      [userId, friendId]
    );

    if (existing.rows.length > 0) {
      const f = existing.rows[0];
      if (f.status === "accepted") return res.status(400).json({ error: "Already friends" });
      if (f.status === "pending") return res.status(400).json({ error: "Request already pending" });
    }

    await pool.query(
      "INSERT INTO friendships (id, user_id, friend_id, status) VALUES ($1, $2, $3, 'pending')",
      [genId(), userId, friendId]
    );

    // Notify the target user
    const sender = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
    const senderName = sender.rows[0]?.name || "Someone";
    await createNotification(friendId, "friend_request", { fromName: senderName, fromUserId: userId });

    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// Accept friend request
router.post("/api/friends/:id/accept", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const friendshipId = req.params.id;

    const result = await pool.query(
      "UPDATE friendships SET status = 'accepted' WHERE id = $1 AND friend_id = $2 AND status = 'pending' RETURNING *",
      [friendshipId, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Request not found" });

    // Notify the original requester that their request was accepted
    const acceptor = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
    const acceptorName = acceptor.rows[0]?.name || "Someone";
    const requesterId = result.rows[0].user_id;
    await createNotification(requesterId, "friend_accepted", { fromName: acceptorName, fromUserId: userId });

    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// Remove friend / decline request
router.delete("/api/friends/:id", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const friendshipId = req.params.id;

    await pool.query(
      "DELETE FROM friendships WHERE id = $1 AND (user_id = $2 OR friend_id = $2)",
      [friendshipId, userId]
    );

    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Nicknames ──

router.put("/api/friends/:id/nickname", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const friendshipId = req.params.id;
    const { nickname } = req.body;

    const result = await pool.query(
      "UPDATE friendships SET nickname = $1 WHERE id = $2 AND (user_id = $3 OR friend_id = $3) RETURNING *",
      [nickname ? nickname.slice(0, NICKNAME_MAX_LENGTH) : null, friendshipId, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Friendship not found" });
    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Game History Between Friends ──

router.get("/api/friends/:friendId/history", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const friendId = req.params.friendId;

    const result = await pool.query(`
      SELECT gh.id, gh.deck_name, gh.game_type, gh.ended_at, gh.player_count,
             gp1.final_score as my_score, gp1.is_winner as my_win,
             gp2.final_score as friend_score, gp2.is_winner as friend_win
      FROM game_history gh
      JOIN game_players gp1 ON gp1.game_id = gh.id AND gp1.user_id = $1
      JOIN game_players gp2 ON gp2.game_id = gh.id AND gp2.user_id = $2
      ORDER BY gh.ended_at DESC LIMIT 20
    `, [userId, friendId]);

    // Summary stats
    const summary = await pool.query(`
      SELECT
        COUNT(*) as games_together,
        COUNT(CASE WHEN gp1.is_winner THEN 1 END) as my_wins,
        COUNT(CASE WHEN gp2.is_winner THEN 1 END) as friend_wins
      FROM game_history gh
      JOIN game_players gp1 ON gp1.game_id = gh.id AND gp1.user_id = $1
      JOIN game_players gp2 ON gp2.game_id = gh.id AND gp2.user_id = $2
    `, [userId, friendId]);

    res.json({ games: result.rows, summary: summary.rows[0] });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Friends Activity Feed ──

router.get("/api/friends/feed", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT gh.id, gh.deck_name, gh.game_type, gh.ended_at, gh.player_count,
             gp.user_id, gp.player_name, gp.final_score, gp.is_winner,
             u.picture, u.name
      FROM game_players gp
      JOIN game_history gh ON gh.id = gp.game_id
      JOIN users u ON u.id = gp.user_id
      WHERE gp.user_id IN (
        SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
        FROM friendships f
        WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
      )
      AND gp.is_bot = FALSE
      ORDER BY gh.ended_at DESC LIMIT 30
    `, [userId]);

    res.json(result.rows);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Friends Leaderboard ──

router.get("/api/friends/leaderboard", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT u.id, u.name, u.picture,
             COUNT(DISTINCT gp.game_id) as total_games,
             COUNT(DISTINCT CASE WHEN gp.is_winner THEN gp.game_id END) as wins,
             COALESCE(SUM(gp.final_score), 0) as total_points
      FROM users u
      JOIN game_players gp ON gp.user_id = u.id AND gp.is_bot = FALSE
      WHERE u.id = $1 OR u.id IN (
        SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
        FROM friendships f
        WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
      )
      GROUP BY u.id, u.name, u.picture
      ORDER BY wins DESC, total_games DESC
    `, [userId]);

    res.json(result.rows);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Mutual Friends ──

router.get("/api/users/:userId/mutual-friends", requireAuth, async (req: any, res) => {
  try {
    const myId = req.user.id;
    const theirId = req.params.userId;

    const result = await pool.query(`
      SELECT u.id, u.name, u.picture FROM users u
      WHERE u.id IN (
        SELECT CASE WHEN f.user_id = $2 THEN f.friend_id ELSE f.user_id END
        FROM friendships f WHERE (f.user_id = $2 OR f.friend_id = $2) AND f.status = 'accepted'
      )
      AND u.id IN (
        SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
        FROM friendships f WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
      )
      AND u.id != $1 AND u.id != $2
    `, [myId, theirId]);

    res.json(result.rows);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Friend Suggestions (people you've played with) ──

router.get("/api/friends/suggestions", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT u.id, u.name, u.picture, COUNT(*) as games_together
      FROM game_players gp1
      JOIN game_players gp2 ON gp2.game_id = gp1.game_id AND gp2.user_id != $1
      JOIN users u ON u.id = gp2.user_id
      WHERE gp1.user_id = $1
        AND gp2.is_bot = FALSE
        AND gp2.user_id NOT IN (
          SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
          FROM friendships f WHERE f.user_id = $1 OR f.friend_id = $1
        )
      GROUP BY u.id, u.name, u.picture
      ORDER BY games_together DESC
      LIMIT 10
    `, [userId]);

    res.json(result.rows);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Direct Messages ──

router.get("/api/friends/:friendId/messages", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const friendId = req.params.friendId;

    if (!await areFriends(userId, friendId)) return res.status(403).json({ error: "Not friends" });

    const before = req.query.before || new Date().toISOString();
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const result = await pool.query(`
      SELECT id, sender_id, receiver_id, content, created_at, read_at
      FROM direct_messages
      WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
        AND created_at < $3
      ORDER BY created_at DESC LIMIT $4
    `, [userId, friendId, before, limit]);

    res.json(result.rows.reverse());
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/friends/:friendId/messages", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const friendId = req.params.friendId;
    const { content } = req.body;

    if (!content?.trim()) return res.status(400).json({ error: "Message content required" });
    if (!await areFriends(userId, friendId)) return res.status(403).json({ error: "Not friends" });

    const trimmed = content.trim().slice(0, DM_MAX_LENGTH);
    const id = genId();
    await pool.query(
      "INSERT INTO direct_messages (id, sender_id, receiver_id, content) VALUES ($1, $2, $3, $4)",
      [id, userId, friendId, trimmed]
    );

    const msg = { id, sender_id: userId, receiver_id: friendId, content: trimmed, created_at: new Date().toISOString(), read_at: null };
    res.json(msg);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/friends/:friendId/messages/read", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const friendId = req.params.friendId;

    if (!await areFriends(userId, friendId)) return res.status(403).json({ error: "Not friends" });

    await pool.query(
      "UPDATE direct_messages SET read_at = NOW() WHERE receiver_id = $1 AND sender_id = $2 AND read_at IS NULL",
      [userId, friendId]
    );
    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Notifications ──

router.get("/api/notifications", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const unreadOnly = req.query.unread === "true";

    const result = await pool.query(`
      SELECT id, type, data, read, created_at
      FROM notifications
      WHERE user_id = $1 ${unreadOnly ? "AND read = FALSE" : ""}
      ORDER BY created_at DESC LIMIT 50
    `, [userId]);

    res.json(result.rows);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/notifications/:id/read", requireAuth, async (req: any, res) => {
  try {
    await pool.query("UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/notifications/read-all", requireAuth, async (req: any, res) => {
  try {
    await pool.query("UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE", [req.user.id]);
    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Unread DM count ──

router.get("/api/friends/unread-counts", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(`
      SELECT sender_id, COUNT(*) as unread_count
      FROM direct_messages
      WHERE receiver_id = $1 AND read_at IS NULL
      GROUP BY sender_id
    `, [userId]);
    const counts: Record<string, number> = {};
    for (const row of result.rows) counts[row.sender_id] = parseInt(row.unread_count);
    res.json(counts);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Push Notifications ──

router.get("/api/push/vapid-key", (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(404).json({ error: "Push not configured" });
  res.json({ publicKey: key });
});

router.post("/api/push/subscribe", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { subscription } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: "Invalid subscription" });

    // Upsert: remove existing sub with same endpoint, then insert
    await pool.query("DELETE FROM push_subscriptions WHERE user_id = $1 AND subscription->>'endpoint' = $2", [userId, subscription.endpoint]);
    await pool.query(
      "INSERT INTO push_subscriptions (id, user_id, subscription) VALUES ($1, $2, $3)",
      [genId(), userId, JSON.stringify(subscription)]
    );
    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/push/unsubscribe", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { endpoint } = req.body;
    if (endpoint) {
      await pool.query("DELETE FROM push_subscriptions WHERE user_id = $1 AND subscription->>'endpoint' = $2", [userId, endpoint]);
    } else {
      await pool.query("DELETE FROM push_subscriptions WHERE user_id = $1", [userId]);
    }
    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
