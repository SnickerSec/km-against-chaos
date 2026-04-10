-- Add art_style column for user-selected art style preference
ALTER TABLE decks ADD COLUMN IF NOT EXISTS art_style TEXT DEFAULT NULL;
