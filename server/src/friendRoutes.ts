import { Router } from "express";
import { requireAuth } from "./auth.js";
import pool from "./db.js";
import { randomBytes } from "crypto";

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

// List friends (accepted) and pending requests
router.get("/api/friends", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;

    const friends = await pool.query(`
      SELECT u.id, u.name, u.picture, f.id as friendship_id, f.status, f.created_at,
             CASE WHEN f.user_id = $1 THEN 'sent' ELSE 'received' END as direction
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
      WHERE (f.user_id = $1 OR f.friend_id = $1)
      ORDER BY f.created_at DESC
    `, [userId]);

    res.json(friends.rows);
  } catch (e: any) {
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
      SELECT u.id, u.name, u.picture, u.email
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
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Send friend request (by email)
router.post("/api/friends/request", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { email } = req.body;

    if (!email) return res.status(400).json({ error: "Email required" });

    // Find user by email
    const target = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (target.rows.length === 0) return res.status(404).json({ error: "User not found" });

    const friendId = target.rows[0].id;
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

    res.json({ success: true });
  } catch (e: any) {
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
    res.json({ success: true });
  } catch (e: any) {
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
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
