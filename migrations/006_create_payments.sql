CREATE TABLE payments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season_id  UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL,
  type       TEXT NOT NULL DEFAULT 'tuition' CHECK (type IN ('tuition', 'fee', 'scholarship', 'refund')),
  paid_date  DATE,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('paid', 'pending', 'late', 'scholarship', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
