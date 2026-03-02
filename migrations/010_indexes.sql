-- Seasons
CREATE INDEX idx_seasons_club_id ON seasons(club_id);
CREATE INDEX idx_seasons_is_current ON seasons(club_id, is_current) WHERE is_current = true;

-- Teams
CREATE INDEX idx_teams_club_season ON teams(club_id, season_id);
CREATE INDEX idx_teams_age_group ON teams(age_group);

-- Players
CREATE INDEX idx_players_club_id ON players(club_id);
CREATE INDEX idx_players_birth_year ON players(club_id, birth_year);
CREATE INDEX idx_players_external_id ON players(club_id, external_id);

-- Player Seasons (retention query hot path)
CREATE INDEX idx_player_seasons_season ON player_seasons(season_id);
CREATE INDEX idx_player_seasons_player ON player_seasons(player_id);
CREATE INDEX idx_player_seasons_team ON player_seasons(team_id);
CREATE INDEX idx_player_seasons_status ON player_seasons(status);

-- Payments
CREATE INDEX idx_payments_club_season ON payments(club_id, season_id);
CREATE INDEX idx_payments_player ON payments(player_id);

-- Uploads
CREATE INDEX idx_uploads_club_id ON uploads(club_id);

-- Audit log
CREATE INDEX idx_audit_log_club_id ON audit_log(club_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity, entity_id);
