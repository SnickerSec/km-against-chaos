import { Router } from "express";
import { randomBytes } from "crypto";
import pool from "./db.js";
import { requireAuth } from "./auth.js";

const router = Router();
const MYINSTANTS = "https://www.myinstants.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
const MAX_SAVED = 50;

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
    // Extract title + mp3 pairs from button onclick attributes and nearby text
    const buttonRegex = /id="([^"]+)"[^>]*>[^<]*<\/button>\s*<span[^>]*>([^<]*)<\/span>/g;
    const playRegex = /play\('(\/media\/sounds\/[^']+\.mp3)'/g;
    // Simpler: just grab all play() paths and all button labels
    const mp3s: string[] = [];
    const titles: string[] = [];
    let m;
    while ((m = playRegex.exec(html)) !== null) mp3s.push(m[1]);
    // Grab instant titles from the page
    const titleRegex = /class="instant-link"[^>]*>([^<]+)<\/a>/g;
    while ((m = titleRegex.exec(html)) !== null) titles.push(m[1].trim());
    for (let i = 0; i < Math.min(mp3s.length, 10); i++) {
      results.push({
        title: titles[i] || `Sound ${i + 1}`,
        mp3: `${MYINSTANTS}${mp3s[i]}`,
      });
    }
    res.json({ results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// List saved sounds
router.get("/saved", requireAuth, async (req: any, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, title, mp3, created_at FROM user_sounds WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Save a sound
router.post("/saved", requireAuth, async (req: any, res) => {
  const { title, mp3 } = req.body;
  if (!title || typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "title is required" }); return;
  }
  if (!mp3 || typeof mp3 !== "string" || !mp3.startsWith("https://www.myinstants.com/")) {
    res.status(400).json({ error: "invalid mp3 URL" }); return;
  }
  try {
    const { rows: existing } = await pool.query(
      "SELECT COUNT(*) as count FROM user_sounds WHERE user_id = $1",
      [req.user.id]
    );
    if (parseInt(existing[0].count) >= MAX_SAVED) {
      res.status(400).json({ error: `Maximum ${MAX_SAVED} saved sounds reached` }); return;
    }
    const id = randomBytes(8).toString("hex");
    const { rows } = await pool.query(
      "INSERT INTO user_sounds (id, user_id, title, mp3) VALUES ($1, $2, $3, $4) RETURNING id, title, mp3, created_at",
      [id, req.user.id, title.trim().slice(0, 100), mp3]
    );
    res.status(201).json(rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a saved sound
router.delete("/saved/:id", requireAuth, async (req: any, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM user_sounds WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (!rowCount) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
