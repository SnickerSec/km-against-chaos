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

  await pool.query(`
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS game_type TEXT DEFAULT 'cah'
  `);

  await pool.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS art_tier TEXT DEFAULT 'free'`);
  await pool.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS art_generation_status TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS draft BOOLEAN DEFAULT FALSE`);

  await pool.query(`
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
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_players (
      id TEXT PRIMARY KEY,
      game_id TEXT REFERENCES game_history(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      player_name TEXT NOT NULL,
      final_score INTEGER DEFAULT 0,
      is_winner BOOLEAN DEFAULT FALSE,
      is_bot BOOLEAN DEFAULT FALSE
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_game_history_ended ON game_history(ended_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      friend_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, friend_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id)
  `);

  // Deck discovery columns
  await pool.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT 0`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deck_ratings (
      id TEXT PRIMARY KEY,
      deck_id TEXT REFERENCES decks(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(deck_id, user_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deck_ratings_deck ON deck_ratings(deck_id)`);

  // Deck favorites
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deck_favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      deck_id TEXT REFERENCES decks(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, deck_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deck_favorites_user ON deck_favorites(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deck_favorites_deck ON deck_favorites(deck_id)`);

  // Friends enrichment columns
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW()`);
  await pool.query(`ALTER TABLE friendships ADD COLUMN IF NOT EXISTS nickname TEXT DEFAULT NULL`);

  // Direct messages
  await pool.query(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      receiver_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      read_at TIMESTAMPTZ DEFAULT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dm_participants ON direct_messages(sender_id, receiver_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dm_receiver ON direct_messages(receiver_id, read_at)`);

  // Notifications
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      data JSONB DEFAULT '{}',
      read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC)`);

  // Push subscriptions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id)`);

  // User saved sounds
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sounds (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      mp3 TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_sounds_user ON user_sounds(user_id)`);

  console.log("Database initialized");
}

export default pool;
