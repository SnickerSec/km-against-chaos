-- Shared art library: every AI-generated image is persisted here for community reuse
CREATE TABLE IF NOT EXISTS art_library (
  id TEXT PRIMARY KEY,
  data BYTEA NOT NULL,
  prompt TEXT NOT NULL,
  source_card_text TEXT NOT NULL DEFAULT '',
  game_type TEXT NOT NULL DEFAULT 'cah',
  deck_name TEXT DEFAULT '',
  width INTEGER NOT NULL DEFAULT 384,
  height INTEGER NOT NULL DEFAULT 512,
  has_speech_bubble BOOLEAN DEFAULT FALSE,
  generated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  flagged BOOLEAN DEFAULT FALSE,
  use_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full-text search on prompt + card text
CREATE INDEX IF NOT EXISTS idx_art_library_search
  ON art_library USING gin(to_tsvector('english', prompt || ' ' || source_card_text));

-- Filter by game type
CREATE INDEX IF NOT EXISTS idx_art_library_game_type ON art_library(game_type);

-- Recent art (gallery browse)
CREATE INDEX IF NOT EXISTS idx_art_library_created ON art_library(created_at DESC);

-- Prevent exact duplicate images from same prompt + card text + game type
CREATE UNIQUE INDEX IF NOT EXISTS idx_art_library_dedup
  ON art_library(md5(prompt || source_card_text || game_type));
