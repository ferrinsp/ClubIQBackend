-- Enable RLS on all tenant-scoped tables
ALTER TABLE seasons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams         ENABLE ROW LEVEL SECURITY;
ALTER TABLE players       ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log     ENABLE ROW LEVEL SECURITY;

-- Policies: restrict rows to current club_id set via session variable
CREATE POLICY club_isolation ON seasons
  USING (club_id::text = current_setting('app.current_club_id', true));

CREATE POLICY club_isolation ON teams
  USING (club_id::text = current_setting('app.current_club_id', true));

CREATE POLICY club_isolation ON players
  USING (club_id::text = current_setting('app.current_club_id', true));

CREATE POLICY club_isolation ON player_seasons
  USING (
    player_id IN (
      SELECT id FROM players
      WHERE club_id::text = current_setting('app.current_club_id', true)
    )
  );

CREATE POLICY club_isolation ON payments
  USING (club_id::text = current_setting('app.current_club_id', true));

CREATE POLICY club_isolation ON uploads
  USING (club_id::text = current_setting('app.current_club_id', true));

CREATE POLICY club_isolation ON audit_log
  USING (club_id::text = current_setting('app.current_club_id', true));
