-- Shared card library for reusing AI-generated text cards across decks
CREATE TABLE IF NOT EXISTS card_library (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  card_type TEXT NOT NULL DEFAULT 'knowledge',  -- 'chaos' or 'knowledge'
  pick INTEGER DEFAULT 1,
  game_type TEXT NOT NULL DEFAULT 'cah',
  maturity TEXT DEFAULT 'adult',
  theme TEXT DEFAULT '',
  flavor_themes JSONB DEFAULT '[]',
  use_count INTEGER DEFAULT 0,
  generated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_library_unique_text
  ON card_library (md5(text || card_type || game_type));

CREATE INDEX IF NOT EXISTS idx_card_library_game_type ON card_library(game_type);
CREATE INDEX IF NOT EXISTS idx_card_library_card_type ON card_library(card_type);
CREATE INDEX IF NOT EXISTS idx_card_library_text_search ON card_library USING gin(to_tsvector('english', text));
