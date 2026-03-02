CREATE TABLE teams (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id           UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  season_id         UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  age_group         TEXT NOT NULL,
  gender            TEXT NOT NULL CHECK (gender IN ('M', 'F', 'Coed')),
  competitive_level TEXT NOT NULL CHECK (competitive_level IN ('rec', 'select', 'premier', 'elite')),
  tuition_amount    INTEGER NOT NULL DEFAULT 0,
  coach_name        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
