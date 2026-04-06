-- Deck discovery: play counts, ratings, favorites
ALTER TABLE decks ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0;
ALTER TABLE decks ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS deck_ratings (
  id TEXT PRIMARY KEY,
  deck_id TEXT REFERENCES decks(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deck_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_deck_ratings_deck ON deck_ratings(deck_id);

CREATE TABLE IF NOT EXISTS deck_favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  deck_id TEXT REFERENCES decks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, deck_id)
);

CREATE INDEX IF NOT EXISTS idx_deck_favorites_user ON deck_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_deck_favorites_deck ON deck_favorites(deck_id);
