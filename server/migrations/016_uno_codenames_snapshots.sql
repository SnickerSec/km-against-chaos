-- Extend runtime state snapshots to Uno and Codenames so active games
-- survive redeploys alongside CAH (see 015_runtime_snapshots.sql).

CREATE TABLE IF NOT EXISTS uno_game_snapshots (
  lobby_code TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS codenames_game_snapshots (
  lobby_code TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
