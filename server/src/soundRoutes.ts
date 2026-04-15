import * as Sentry from "@sentry/node";
import { Router } from "express";
import { randomBytes } from "crypto";
import pool from "./db.js";
import { requireAuth } from "./auth.js";

const router = Router();
const MYINSTANTS = "https://www.myinstants.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
const MAX_SAVED = 50;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

// Manual JSON body parsing (project convention)
router.use((req, res, next) => {
  if (req.headers["content-type"]?.includes("application/json")) {
    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8192) { res.status(413).json({ error: "Request too large" }); req.destroy(); return; }
      body += chunk;
    });
    req.on("end", () => {
      try { (req as any).body = JSON.parse(body); } catch { (req as any).body = {}; }
      next();
    });
  } else {
    (req as any).body = {};
    next();
  }
});

// Download a MyInstants URL once and upsert into the shared sounds cache.
// Returns the sound id.
const ALLOWED_SOUND_HOST = "www.myinstants.com";

const SAFE_SOUND_PATH = /^\/media\/sounds\/[A-Za-z0-9_\-]+\.mp3$/;

async function getOrCreateSound(mp3Url: string, title: string): Promise<string> {
  // Guard against SSRF — only fetch from myinstants.com with expected path shape
  const parsed = new URL(mp3Url);
  if (parsed.protocol !== "https:" || parsed.hostname !== ALLOWED_SOUND_HOST) {
    throw new Error("Only myinstants.com URLs are allowed");
  }
  if (!SAFE_SOUND_PATH.test(parsed.pathname)) {
    throw new Error("Invalid sound URL path");
  }

  const existing = await pool.query("SELECT id FROM sounds WHERE mp3_url = $1", [mp3Url]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  // Hard-code host; path has been validated by regex above to prevent SSRF
  const safeUrl = `https://${ALLOWED_SOUND_HOST}${parsed.pathname}`;
  const r = await fetch(safeUrl, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("Failed to download sound from MyInstants");
  const buffer = Buffer.from(await r.arrayBuffer());
  if (buffer.length > MAX_FILE_BYTES) throw new Error("Sound file too large (max 5MB)");

  const id = randomBytes(8).toString("hex");
  const { rows } = await pool.query(
    `INSERT INTO sounds (id, mp3_url, title, data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (mp3_url) DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
    [id, mp3Url, title, buffer]
  );
  return rows[0].id;
}

// Search myinstants.com, return up to 10 results
router.get("/search", async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== "string" || !q.trim()) {
    res.status(400).json({ error: "q is required" });
    return;
  }
  try {
    const r = await fetch(
      `${MYINSTANTS}/en/search/?name=${encodeURIComponent(q.trim())}`,
      { headers: { "User-Agent": UA } }
    );
    if (!r.ok) { res.status(404).json({ results: [] }); return; }
    const html = await r.text();
    const results: { title: string; mp3: string }[] = [];
    const playRegex = /play\('(\/media\/sounds\/[^']+\.mp3)'/g;
    const mp3s: string[] = [];
    const titles: string[] = [];
    let m;
    while ((m = playRegex.exec(html)) !== null) mp3s.push(m[1]);
    const titleRegex = /class="instant-link[^"]*"[^>]*>([^<]+)<\/a>/g;
    while ((m = titleRegex.exec(html)) !== null) titles.push(m[1].trim());
    for (let i = 0; i < Math.min(mp3s.length, 10); i++) {
      results.push({ title: titles[i] || `Sound ${i + 1}`, mp3: `${MYINSTANTS}${mp3s[i]}` });
    }
    res.json({ results });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// Serve a cached sound file
router.get("/file/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT data FROM sounds WHERE id = $1", [req.params.id]);
    if (!rows.length) { res.status(404).end(); return; }
    const buf: Buffer = rows[0].data;
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(buf);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// List saved sounds
router.get("/saved", requireAuth, async (req: any, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT us.id, s.title, '/api/sounds/file/' || s.id AS mp3, s.mp3_url AS source_mp3, us.created_at
       FROM user_sounds us
       JOIN sounds s ON us.sound_id = s.id
       WHERE us.user_id = $1
       ORDER BY us.play_count DESC, us.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// Save a sound — downloads once into shared cache if not already there
router.post("/saved", requireAuth, async (req: any, res) => {
  const { title, mp3 } = req.body;
  if (!title || typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "title is required" }); return;
  }
  if (!mp3 || typeof mp3 !== "string" || !mp3.startsWith("https://www.myinstants.com/")) {
    res.status(400).json({ error: "invalid mp3 URL" }); return;
  }
  try {
    const { rows: countRows } = await pool.query(
      "SELECT COUNT(*) AS count FROM user_sounds WHERE user_id = $1",
      [req.user.id]
    );
    if (parseInt(countRows[0].count) >= MAX_SAVED) {
      res.status(400).json({ error: `Maximum ${MAX_SAVED} saved sounds reached` }); return;
    }

    const soundId = await getOrCreateSound(mp3, title.trim().slice(0, 100));

    // Idempotent — don't duplicate if user already saved this sound
    const { rows: already } = await pool.query(
      "SELECT id FROM user_sounds WHERE user_id = $1 AND sound_id = $2",
      [req.user.id, soundId]
    );
    const userSoundId = already.length > 0 ? already[0].id : randomBytes(8).toString("hex");
    if (already.length === 0) {
      await pool.query(
        "INSERT INTO user_sounds (id, user_id, sound_id, title, mp3) VALUES ($1, $2, $3, $4, $5)",
        [userSoundId, req.user.id, soundId, title.trim().slice(0, 100), mp3]
      );
    }

    const { rows } = await pool.query(
      `SELECT us.id, s.title, '/api/sounds/file/' || s.id AS mp3, s.mp3_url AS source_mp3, us.created_at
       FROM user_sounds us JOIN sounds s ON us.sound_id = s.id
       WHERE us.id = $1`,
      [userSoundId]
    );
    res.status(already.length > 0 ? 200 : 201).json(rows[0]);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// Increment play count for a saved sound
router.post("/saved/:id/play", requireAuth, async (req: any, res) => {
  try {
    const { rowCount } = await pool.query(
      "UPDATE user_sounds SET play_count = play_count + 1 WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (!rowCount) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// Delete a saved sound (shared cache entry is kept for other users)
router.delete("/saved/:id", requireAuth, async (req: any, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM user_sounds WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (!rowCount) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
