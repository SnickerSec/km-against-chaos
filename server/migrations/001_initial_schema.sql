-- Users and decks core tables
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  picture TEXT DEFAULT ''
);

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
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
);

-- Columns added to existing tables in early upgrades
ALTER TABLE decks ADD COLUMN IF NOT EXISTS win_condition JSONB NOT NULL DEFAULT '{"mode":"rounds","value":10}';
ALTER TABLE decks ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(id);
ALTER TABLE packs ADD COLUMN IF NOT EXISTS built_in BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT NULL;
