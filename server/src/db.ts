import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : undefined,
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      chaos_cards JSONB NOT NULL DEFAULT '[]',
      knowledge_cards JSONB NOT NULL DEFAULT '[]',
      win_condition JSONB NOT NULL DEFAULT '{"mode":"rounds","value":10}',
      built_in BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Add win_condition column if upgrading from old schema
  await pool.query(`
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS win_condition JSONB NOT NULL DEFAULT '{"mode":"rounds","value":10}'
  `);

  console.log("Database initialized");
}

export default pool;
