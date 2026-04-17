// One-shot migration — uploads existing art_library rows' bytea to R2
// and populates r2_key. Skips rows that already have r2_key (idempotent).
// Run inside the Railway container:
//     railway ssh -s decked.gg "cd /app && node server/dist/scripts/migrate-art-library-to-r2.js"

import pool from "../db.js";
import { putObject } from "../storage.js";
import { createLogger } from "../logger.js";

const log = createLogger("migrate-art-r2");

function sniffImage(buf: Buffer): { ext: "png" | "jpg" | "webp" | "gif"; mime: string } {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: "png", mime: "image/png" };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return { ext: "webp", mime: "image/webp" };
  }
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { ext: "gif", mime: "image/gif" };
  }
  return { ext: "jpg", mime: "image/jpeg" };
}

async function migrate() {
  const { rows } = await pool.query<{ id: string; data: Buffer }>(
    "SELECT id, data FROM art_library WHERE r2_key IS NULL AND data IS NOT NULL"
  );
  log.info("art_library rows to migrate", { count: rows.length });

  if (rows.length === 0) {
    log.info("nothing to do");
    return;
  }

  let uploaded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const { ext, mime } = sniffImage(row.data);
      const key = `art/${row.id}.${ext}`;
      await putObject(key, row.data, mime);
      await pool.query("UPDATE art_library SET r2_key = $1 WHERE id = $2", [key, row.id]);
      log.info("migrated", { id: row.id, bytes: row.data.length, to: key });
      uploaded++;
    } catch (err) {
      log.error("failed", { id: row.id, error: String(err) });
      failed++;
    }
  }

  log.info("done", { uploaded, failed, total: rows.length });
}

migrate()
  .catch((err) => {
    log.error("fatal", { error: String(err) });
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
