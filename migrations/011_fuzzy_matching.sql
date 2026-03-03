-- Enable pg_trgm extension for fuzzy string matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN indexes for trigram-based fuzzy matching on player names
CREATE INDEX IF NOT EXISTS idx_players_first_name_trgm ON players USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_players_last_name_trgm ON players USING gin (last_name gin_trgm_ops);
