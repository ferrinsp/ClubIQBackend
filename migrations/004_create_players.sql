CREATE TABLE players (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  external_id TEXT,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  birth_year  INTEGER NOT NULL,
  gender      TEXT NOT NULL CHECK (gender IN ('M', 'F')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (club_id, external_id)
);
