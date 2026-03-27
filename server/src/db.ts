import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : undefined,
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      picture TEXT DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      chaos_cards JSONB NOT NULL DEFAULT '[]',
      knowledge_cards JSONB NOT NULL DEFAULT '[]',
      win_condition JSONB NOT NULL DEFAULT '{"mode":"rounds","value":10}',
      built_in BOOLEAN DEFAULT FALSE,
      owner_id TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Add columns if upgrading from old schema
  await pool.query(`
    CREATE TABLE IF NOT EXISTS packs (
      id TEXT PRIMARY KEY,
      deck_id TEXT REFERENCES decks(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      chaos_cards JSONB NOT NULL DEFAULT '[]',
      knowledge_cards JSONB NOT NULL DEFAULT '[]',
      owner_id TEXT REFERENCES users(id),
      built_in BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Add columns if upgrading from old schema
  await pool.query(`
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS win_condition JSONB NOT NULL DEFAULT '{"mode":"rounds","value":10}'
  `);
  await pool.query(`
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(id)
  `);
  await pool.query(`
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS built_in BOOLEAN DEFAULT FALSE
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT NULL
  `);

  // 4-Pillar recipe columns
  await pool.query(`
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS maturity TEXT DEFAULT 'adult'
  `);
  await pool.query(`
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS flavor_themes JSONB DEFAULT '[]'
  `);
  await pool.query(`
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS chaos_level INTEGER DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS wildcard TEXT DEFAULT ''
  `);
  await pool.query(`
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS remixed_from TEXT REFERENCES decks(id)
  `);

  console.log("Database initialized");
}

export default pool;
