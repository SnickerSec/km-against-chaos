-- Game history and player results
CREATE TABLE IF NOT EXISTS game_history (
  id TEXT PRIMARY KEY,
  lobby_code TEXT NOT NULL,
  deck_id TEXT,
  deck_name TEXT NOT NULL,
  game_type TEXT NOT NULL DEFAULT 'cah',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ DEFAULT NOW(),
  player_count INTEGER NOT NULL,
  rounds_played INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_players (
  id TEXT PRIMARY KEY,
  game_id TEXT REFERENCES game_history(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  player_name TEXT NOT NULL,
  final_score INTEGER DEFAULT 0,
  is_winner BOOLEAN DEFAULT FALSE,
  is_bot BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);
CREATE INDEX IF NOT EXISTS idx_game_history_ended ON game_history(ended_at DESC);
