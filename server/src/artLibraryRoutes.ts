import * as Sentry from "@sentry/node";
import { Router } from "express";
import sharp from "sharp";
import pool from "./db.js";
import { createLogger } from "./logger.js";

const log = createLogger("art-library");
const router = Router();

// Browse / search the art library
router.get("/browse", async (req, res) => {
  try {
    const q = (req.query.q as string || "").trim();
    const gameType = req.query.gameType as string || "";
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit as string) || 24));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["flagged = FALSE"];
    const params: any[] = [];
    let paramIndex = 1;

    if (q) {
      conditions.push(`to_tsvector('english', prompt || ' ' || source_card_text) @@ plainto_tsquery('english', $${paramIndex})`);
      params.push(q);
      paramIndex++;
    }

    if (gameType) {
      conditions.push(`game_type = $${paramIndex}`);
      params.push(gameType);
      paramIndex++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM art_library ${where}`, params),
      pool.query(
        `SELECT id, prompt, source_card_text, game_type, deck_name, width, height, has_speech_bubble, use_count, created_at
         FROM art_library ${where}
         ORDER BY created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset]
      ),
    ]);

    const total = parseInt(countResult.rows[0].count);
    res.json({
      results: dataResult.rows.map((r: any) => ({
        id: r.id,
        prompt: r.prompt,
        sourceCardText: r.source_card_text,
        gameType: r.game_type,
        deckName: r.deck_name,
        width: r.width,
        height: r.height,
        hasSpeechBubble: r.has_speech_bubble,
        useCount: r.use_count,
        createdAt: r.created_at,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (e: any) { Sentry.captureException(e);
    log.error("browse failed", { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// Serve full-size image
router.get("/image/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT data FROM art_library WHERE id = $1", [req.params.id]);
    if (!rows.length) { res.status(404).end(); return; }
    const buf: Buffer = rows[0].data;
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(buf);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// Serve thumbnail (resized on-the-fly, cached by browser)
router.get("/thumb/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT data, width, height FROM art_library WHERE id = $1", [req.params.id]);
    if (!rows.length) { res.status(404).end(); return; }

    const thumbWidth = 128;
    const aspectRatio = rows[0].height / rows[0].width;
    const thumbHeight = Math.round(thumbWidth * aspectRatio);

    const thumb = await sharp(rows[0].data)
      .resize(thumbWidth, thumbHeight, { fit: "cover" })
      .jpeg({ quality: 70 })
      .toBuffer();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", thumb.length);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(thumb);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

// Increment use count when art is assigned to a card
router.post("/use/:id", async (req, res) => {
  try {
    await pool.query("UPDATE art_library SET use_count = use_count + 1 WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
