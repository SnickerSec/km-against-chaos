-- Add Blackjack game type: snapshot table + a built-in deck row so users
-- can pick "Blackjack" from the lobby without authoring a deck.

CREATE TABLE IF NOT EXISTS blackjack_game_snapshots (
  lobby_code TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO decks (id, name, description, chaos_cards, knowledge_cards, win_condition, owner_id, built_in, game_type)
VALUES (
  'builtin-blackjack',
  'Blackjack',
  'Casino-style blackjack with virtual chips. Last player standing wins.',
  '[]'::jsonb,
  '[]'::jsonb,
  '{}'::jsonb,
  NULL,
  TRUE,
  'blackjack'
)
ON CONFLICT (id) DO NOTHING;