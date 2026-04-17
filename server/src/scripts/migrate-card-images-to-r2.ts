// One-shot migration — walks every deck's chaos_cards and knowledge_cards
// arrays and rewrites any per-card imageUrl that's either a fal.ai URL or
// a data:image/* URI into an R2 object under card-images/{deckId}/{cardId}.{ext}.
//
// Run inside the Railway container:
//     railway ssh -s decked.gg "cd /app && node server/dist/scripts/migrate-card-images-to-r2.js"
//
// Idempotent — it only touches URLs that aren't already R2 URLs (cdn.decked.gg
// or r2.dev), so re-running is a no-op.

import pool from "../db.js";
import { putObject } from "../storage.js";
import { createLogger } from "../logger.js";

const log = createLogger("migrate-cards-r2");

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

function isAlreadyMigrated(url: string): boolean {
  return url.includes("cdn.decked.gg") || url.includes("r2.dev");
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn("fetch failed", { url: url.slice(0, 100), status: res.status });
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    log.warn("fetch error", { url: url.slice(0, 100), error: String(err) });
    return null;
  }
}

async function migrateOne(
  deckId: string,
  card: any
): Promise<{ changed: boolean; reason?: string; newUrl?: string }> {
  if (!card.imageUrl) return { changed: false, reason: "no_url" };
  if (isAlreadyMigrated(card.imageUrl)) return { changed: false, reason: "already_r2" };

  let buffer: Buffer | null = null;

  if (card.imageUrl.startsWith("data:")) {
    // data:image/png;base64,AAAA...
    const [, b64] = card.imageUrl.split(",");
    if (!b64) return { changed: false, reason: "bad_data_uri" };
    buffer = Buffer.from(b64, "base64");
  } else if (card.imageUrl.startsWith("http://") || card.imageUrl.startsWith("https://")) {
    buffer = await fetchBuffer(card.imageUrl);
    if (!buffer) return { changed: false, reason: "fetch_failed" };
  } else {
    return { changed: false, reason: "unknown_scheme" };
  }

  const { ext, mime } = sniffImage(buffer);
  const safeId = card.id.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `card-images/${deckId}/${safeId}.${ext}`;
  const newUrl = await putObject(key, buffer, mime);
  return { changed: true, newUrl };
}

async function migrate() {
  const { rows: decks } = await pool.query<{ id: string; name: string; chaos_cards: any[]; knowledge_cards: any[] }>(
    "SELECT id, name, chaos_cards, knowledge_cards FROM decks"
  );

  let totalCards = 0;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const deck of decks) {
    let dirty = false;
    for (const field of ["chaos_cards", "knowledge_cards"] as const) {
      const cards = (deck as any)[field];
      if (!Array.isArray(cards)) continue;
      for (const card of cards) {
        totalCards++;
        try {
          const r = await migrateOne(deck.id, card);
          if (r.changed) {
            card.imageUrl = r.newUrl;
            dirty = true;
            migrated++;
            log.info("migrated", { deck: deck.name, cardId: card.id, to: r.newUrl });
          } else if (r.reason !== "no_url" && r.reason !== "already_r2") {
            skipped++;
            log.warn("skipped", { deck: deck.name, cardId: card.id, reason: r.reason });
          }
        } catch (err) {
          failed++;
          log.error("migration error", { deck: deck.name, cardId: card.id, error: String(err) });
        }
      }
    }

    if (dirty) {
      await pool.query(
        "UPDATE decks SET chaos_cards = $1, knowledge_cards = $2, updated_at = NOW() WHERE id = $3",
        [JSON.stringify(deck.chaos_cards), JSON.stringify(deck.knowledge_cards), deck.id]
      );
      log.info("deck saved", { deck: deck.name });
    }
  }

  log.info("done", { totalCards, migrated, skipped, failed });
}

migrate()
  .catch((err) => {
    log.error("fatal", { error: String(err) });
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
