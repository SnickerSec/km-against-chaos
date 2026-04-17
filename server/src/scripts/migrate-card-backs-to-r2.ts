// One-shot migration script — moves existing card-back images from the
// Railway persistent volume (/uploads/card-backs/) into Cloudflare R2 and
// rewrites the /uploads/... URLs in the `decks.card_back_url` column to
// point at the R2 public URL.
//
// Run from inside the Railway container (where both the volume and the R2
// env vars are available):
//     railway ssh -s decked.gg "cd /app && node server/dist/scripts/migrate-card-backs-to-r2.js"
//
// Idempotent: it only rewrites rows that still start with "/uploads/" so
// re-running it is a no-op.
//
// Safe to abandon TTS cache and other /uploads/* files — no DB column
// references anything other than card backs (verified via information_schema
// scan).

import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import pool from "../db.js";
import { putObject } from "../storage.js";
import { createLogger } from "../logger.js";

const log = createLogger("migrate-r2");

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), "uploads");
const CARD_BACK_DIR = join(UPLOAD_DIR, "card-backs");

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

async function migrate() {
  const { rows } = await pool.query<{ id: string; card_back_url: string }>(
    `SELECT id, card_back_url FROM decks WHERE card_back_url LIKE '/uploads/card-backs/%'`
  );
  log.info("card backs to migrate", { count: rows.length });

  if (rows.length === 0) {
    log.info("nothing to do — all card_back_url values are already off /uploads/");
    return;
  }

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // Strip the ?v=... cache-bust suffix to get the actual path
      const urlPath = row.card_back_url.split("?")[0]; // e.g. /uploads/card-backs/442ca007.png
      const relative = urlPath.replace(/^\/uploads\//, "");  // card-backs/442ca007.png
      const localPath = join(UPLOAD_DIR, relative);

      if (!existsSync(localPath)) {
        log.warn("local file missing — skipping", { deckId: row.id, path: localPath });
        skipped++;
        continue;
      }

      const ext = localPath.split(".").pop()?.toLowerCase() || "";
      const contentType = EXT_MIME[ext] || "application/octet-stream";

      const buf = readFileSync(localPath);
      const size = buf.length;

      const newUrl = await putObject(relative, buf, contentType);
      // Preserve the cache-bust query string so clients don't re-fetch on
      // no-change.
      const qs = row.card_back_url.includes("?") ? "?" + row.card_back_url.split("?")[1] : "";
      const finalUrl = `${newUrl}${qs}`;

      await pool.query(
        `UPDATE decks SET card_back_url = $1, updated_at = NOW() WHERE id = $2`,
        [finalUrl, row.id]
      );

      log.info("migrated", { deckId: row.id, bytes: size, to: newUrl });
      uploaded++;
    } catch (err) {
      log.error("migration failed for deck", { deckId: row.id, error: String(err) });
      failed++;
    }
  }

  log.info("done", { uploaded, skipped, failed, total: rows.length });
}

migrate()
  .catch((err) => {
    log.error("fatal", { error: String(err) });
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
