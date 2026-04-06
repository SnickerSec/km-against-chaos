-- Shared sound cache
CREATE TABLE IF NOT EXISTS sounds (
  id TEXT PRIMARY KEY,
  mp3_url TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sounds_mp3_url ON sounds(mp3_url);

-- User saved sounds
CREATE TABLE IF NOT EXISTS user_sounds (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  sound_id TEXT REFERENCES sounds(id),
  title TEXT NOT NULL,
  mp3 TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_sounds ADD COLUMN IF NOT EXISTS sound_id TEXT REFERENCES sounds(id);
CREATE INDEX IF NOT EXISTS idx_user_sounds_user ON user_sounds(user_id);
