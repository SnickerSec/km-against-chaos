import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type pg from "pg";
import { createLogger } from "./logger.js";

const log = createLogger("migrate");

export async function runMigrations(pool: pg.Pool): Promise<void> {
  // Ensure migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Find migration files
  const migrationsDir = join(__dirname, "..", "migrations");
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    log.warn("no migration files found", { dir: migrationsDir });
    return;
  }

  // Check which have already been applied
  const { rows: applied } = await pool.query("SELECT name FROM migrations");
  const appliedSet = new Set(applied.map(r => r.name));

  const pending = files.filter(f => !appliedSet.has(f));
  if (pending.length === 0) {
    log.info("all migrations applied", { total: files.length });
    return;
  }

  // Apply each pending migration in order
  for (const file of pending) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      log.info("migration applied", { name: file });
    } catch (err) {
      await client.query("ROLLBACK");
      log.error("migration failed", { name: file, error: String(err) });
      throw err;
    } finally {
      client.release();
    }
  }

  log.info("migrations complete", { applied: pending.length, total: files.length });
}
