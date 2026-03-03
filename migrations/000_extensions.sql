-- Ensure required PostgreSQL extensions are available before any migration uses them.
-- pg_trgm: trigram-based fuzzy string matching (used in 011_fuzzy_matching.sql)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
