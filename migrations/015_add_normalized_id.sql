-- Add normalized_id column for deterministic player dedup
ALTER TABLE players ADD COLUMN normalized_id TEXT;

-- Index for fast lookup
CREATE INDEX idx_players_normalized_id ON players (club_id, normalized_id);

-- Backfill existing players
UPDATE players SET normalized_id = left(encode(sha256(
  convert_to(lower(trim(first_name)) || '|' || lower(trim(last_name)) || '|' || birth_year::text, 'UTF8')
), 'hex'), 16);
