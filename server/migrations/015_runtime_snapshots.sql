-- Runtime state snapshots — written on SIGTERM, replayed on startup,
-- then truncated so state is not replayed on a subsequent crash.

CREATE TABLE IF NOT EXISTS lobby_snapshots (
  code TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cah_game_snapshots (
  lobby_code TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_snapshots (
  code TEXT PRIMARY KEY,
  messages JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
