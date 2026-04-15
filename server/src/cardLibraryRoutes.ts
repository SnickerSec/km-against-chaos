import * as Sentry from "@sentry/node";
import { Router } from "express";
import { randomBytes } from "crypto";
import pool from "./db.js";
import { createLogger } from "./logger.js";

const log = createLogger("card-library");
const router = Router();

// Save generated cards to the library (fire-and-forget, deduplicates on text+type+gameType)
export async function saveCardsToLibrary(
  cards: { text: string; pick?: number; type: "chaos" | "knowledge" }[],
  context: { gameType: string; maturity?: string; theme?: string; flavorThemes?: string[]; generatedBy?: string },
): Promise<void> {
  if (cards.length === 0) return;
  try {
    const values: string[] = [];
    const params: any[] = [];
    let idx = 1;
    for (const card of cards) {
      const id = randomBytes(8).toString("hex");
      values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8})`);
      params.push(
        id,
        card.text,
        card.type,
        card.pick || 1,
        context.gameType || "cah",
        context.maturity || "adult",
        context.theme || "",
        JSON.stringify(context.flavorThemes || []),
        context.generatedBy || null,
      );
      idx += 9;
    }
    await pool.query(
      `INSERT INTO card_library (id, text, card_type, pick, game_type, maturity, theme, flavor_themes, generated_by)
       VALUES ${values.join(", ")}
       ON CONFLICT (md5(text || card_type || game_type)) DO NOTHING`,
      params,
    );
  } catch (err) {
    log.error("failed to save cards to library", { error: String(err) });
  }
}

// Browse / search the card library
router.get("/browse", async (req, res) => {
  try {
    const q = (req.query.q as string || "").trim();
    const gameType = req.query.gameType as string || "";
    const cardType = req.query.cardType as string || "";
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (q) {
      conditions.push(`to_tsvector('english', text) @@ plainto_tsquery('english', $${paramIndex})`);
      params.push(q);
      paramIndex++;
    }

    if (gameType) {
      conditions.push(`game_type = $${paramIndex}`);
      params.push(gameType);
      paramIndex++;
    }

    if (cardType === "chaos" || cardType === "knowledge") {
      conditions.push(`card_type = $${paramIndex}`);
      params.push(cardType);
      paramIndex++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM card_library ${where}`, params),
      pool.query(
        `SELECT id, text, card_type, pick, game_type, maturity, theme, use_count, created_at
         FROM card_library ${where}
         ORDER BY use_count DESC, created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset],
      ),
    ]);

    const total = parseInt(countResult.rows[0].count);
    res.json({
      results: dataResult.rows.map((r: any) => ({
        id: r.id,
        text: r.text,
        cardType: r.card_type,
        pick: r.pick,
        gameType: r.game_type,
        maturity: r.maturity,
        theme: r.theme,
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

// Increment use count when card is added to a deck
router.post("/use", async (req, res) => {
  try {
    const { ids } = (req as any).body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids array required" });
      return;
    }
    const placeholders = ids.map((_: string, i: number) => `$${i + 1}`).join(", ");
    await pool.query(
      `UPDATE card_library SET use_count = use_count + 1 WHERE id IN (${placeholders})`,
      ids,
    );
    res.json({ success: true });
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
