import { pool } from '../db.js';

export interface SeasonStats {
  totalPlayers: number;
  teamCount: number;
}

/**
 * Player count and team count for a given season.
 */
export async function getSeasonStats(
  clubId: string,
  seasonId: string,
): Promise<SeasonStats> {
  const { rows } = await pool.query(
    `SELECT
       count(DISTINCT ps.player_id)::int as total_players,
       count(DISTINCT t.id)::int as team_count
     FROM player_seasons ps
     JOIN teams t ON t.id = ps.team_id AND t.club_id = $1
     WHERE ps.season_id = $2`,
    [clubId, seasonId],
  );
  return { totalPlayers: rows[0].total_players, teamCount: rows[0].team_count };
}

/**
 * Total paid revenue for a season, converted from cents to dollars.
 */
export async function getSeasonRevenue(
  clubId: string,
  seasonId: string,
): Promise<number> {
  const { rows } = await pool.query(
    `SELECT coalesce(sum(amount), 0)::bigint as total_revenue
     FROM payments WHERE club_id = $1 AND season_id = $2 AND status = 'paid'`,
    [clubId, seasonId],
  );
  return Math.round(Number(rows[0].total_revenue) / 100);
}
