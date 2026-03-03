import type { RouteHandler } from '../types.js';
import { ok, badRequest } from '../lib/response.js';
import { pool } from '../db.js';
import { extractAuth, isAuthError } from '../middleware/auth.js';

interface SeasonBaseline {
  totalPlayers: number;
  totalRevenue: number;
  avgTuition: number;
  avgRosterSize: number;
  retentionRate: number;
  teamCount: number;
}

async function getBaseline(clubId: string, seasonId?: string): Promise<{ baseline: SeasonBaseline; seasonId: string; seasonName: string; prevSeasonId: string | null } | null> {
  // Get season
  const seasonQuery = seasonId
    ? 'SELECT id, name FROM seasons WHERE id = $1 AND club_id = $2'
    : 'SELECT id, name FROM seasons WHERE club_id = $1 AND is_current = true';
  const seasonParams = seasonId ? [seasonId, clubId] : [clubId];
  const { rows: seasonRows } = await pool.query(seasonQuery, seasonParams);
  if (seasonRows.length === 0) return null;
  const season = seasonRows[0];

  // Previous season
  const { rows: prevRows } = await pool.query(
    `SELECT id FROM seasons WHERE club_id = $1 AND end_date < (SELECT start_date FROM seasons WHERE id = $2)
     ORDER BY end_date DESC LIMIT 1`,
    [clubId, season.id]
  );
  const prevSeasonId = prevRows[0]?.id ?? null;

  // Current season stats
  const { rows: stats } = await pool.query(
    `SELECT
       count(DISTINCT ps.player_id)::int as total_players,
       count(DISTINCT t.id)::int as team_count
     FROM player_seasons ps
     JOIN teams t ON t.id = ps.team_id AND t.club_id = $1
     WHERE ps.season_id = $2`,
    [clubId, season.id]
  );

  const { rows: revenueRows } = await pool.query(
    `SELECT coalesce(sum(amount), 0)::bigint as total_revenue
     FROM payments WHERE club_id = $1 AND season_id = $2 AND status = 'paid'`,
    [clubId, season.id]
  );

  // Retention rate
  let retentionRate = 74; // default
  if (prevSeasonId) {
    const { rows: retRows } = await pool.query(
      `SELECT
         count(DISTINCT prev.player_id)::int as prev_total,
         count(DISTINCT CASE WHEN curr.player_id IS NOT NULL THEN prev.player_id END)::int as returning
       FROM player_seasons prev
       JOIN teams t ON t.id = prev.team_id AND t.club_id = $1
       LEFT JOIN player_seasons curr ON curr.player_id = prev.player_id AND curr.season_id = $3
       WHERE prev.season_id = $2`,
      [clubId, prevSeasonId, season.id]
    );
    const prevTotal = retRows[0].prev_total;
    const returning = retRows[0].returning;
    if (prevTotal > 0) {
      retentionRate = Math.round((returning / prevTotal) * 1000) / 10;
    }
  }

  const totalPlayers = stats[0].total_players;
  const teamCount = stats[0].team_count;
  const totalRevenue = Math.round(Number(revenueRows[0].total_revenue) / 100); // cents → dollars
  const avgTuition = totalPlayers > 0 ? Math.round(totalRevenue / totalPlayers) : 0;
  const avgRosterSize = teamCount > 0 ? Math.round(totalPlayers / teamCount) : 19;

  return {
    baseline: { totalPlayers, totalRevenue, avgTuition, avgRosterSize, retentionRate, teamCount },
    seasonId: season.id,
    seasonName: season.name,
    prevSeasonId,
  };
}

/**
 * GET /revenue/forecast
 * Returns base, optimistic, and pessimistic revenue scenarios.
 */
export const revenueForecastHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const result = await getBaseline(auth.clubId, event.queryStringParameters?.seasonId);
  if (!result) return badRequest('Season not found');

  const { baseline, seasonName } = result;
  const { totalPlayers, totalRevenue, avgTuition, retentionRate } = baseline;

  // Base scenario: current retention rate
  const baseReturning = Math.round(totalPlayers * (retentionRate / 100));
  const baseRevenue = baseReturning * avgTuition;

  // Optimistic: +5% retention
  const optRate = Math.min(100, retentionRate + 5);
  const optReturning = Math.round(totalPlayers * (optRate / 100));
  const optRevenue = optReturning * avgTuition;

  // Pessimistic: -5% retention
  const pessRate = Math.max(0, retentionRate - 5);
  const pessReturning = Math.round(totalPlayers * (pessRate / 100));
  const pessRevenue = pessReturning * avgTuition;

  // Break-even
  const revenueGap = baseRevenue - totalRevenue;
  const breakEvenNewPlayers = revenueGap < 0 ? Math.ceil(Math.abs(revenueGap) / avgTuition) : 0;

  return ok({
    season: seasonName,
    currentRevenue: totalRevenue,
    currentPlayers: totalPlayers,
    retentionRate,
    scenarios: {
      base: {
        label: 'Base',
        retentionRate,
        projectedPlayers: baseReturning,
        projectedRevenue: baseRevenue,
        revenueChange: baseRevenue - totalRevenue,
        revenueChangePct: totalRevenue > 0 ? Math.round(((baseRevenue - totalRevenue) / totalRevenue) * 1000) / 10 : 0,
      },
      optimistic: {
        label: 'Optimistic',
        retentionRate: optRate,
        projectedPlayers: optReturning,
        projectedRevenue: optRevenue,
        revenueChange: optRevenue - totalRevenue,
        revenueChangePct: totalRevenue > 0 ? Math.round(((optRevenue - totalRevenue) / totalRevenue) * 1000) / 10 : 0,
      },
      pessimistic: {
        label: 'Pessimistic',
        retentionRate: pessRate,
        projectedPlayers: pessReturning,
        projectedRevenue: pessRevenue,
        revenueChange: pessRevenue - totalRevenue,
        revenueChangePct: totalRevenue > 0 ? Math.round(((pessRevenue - totalRevenue) / totalRevenue) * 1000) / 10 : 0,
      },
    },
    breakEven: {
      newPlayersNeeded: breakEvenNewPlayers,
      avgTuitionPerPlayer: avgTuition,
    },
  });
};

/**
 * GET /revenue/by-age-group
 * Revenue breakdown by age group for the current season.
 */
export const revenueByAgeGroupHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const seasonId = event.queryStringParameters?.seasonId;
  const seasonQuery = seasonId
    ? 'SELECT id FROM seasons WHERE id = $1 AND club_id = $2'
    : 'SELECT id FROM seasons WHERE club_id = $1 AND is_current = true';
  const seasonParams = seasonId ? [seasonId, auth.clubId] : [auth.clubId];
  const { rows: seasonRows } = await pool.query(seasonQuery, seasonParams);
  if (seasonRows.length === 0) return badRequest('Season not found');
  const sid = seasonRows[0].id;

  const { rows } = await pool.query(
    `SELECT
       t.age_group,
       count(DISTINCT ps.player_id)::int as player_count,
       coalesce(sum(pay.amount), 0)::bigint as total_revenue
     FROM player_seasons ps
     JOIN teams t ON t.id = ps.team_id AND t.club_id = $1
     LEFT JOIN payments pay ON pay.player_id = ps.player_id AND pay.season_id = ps.season_id AND pay.status = 'paid'
     WHERE ps.season_id = $2
     GROUP BY t.age_group
     ORDER BY t.age_group`,
    [auth.clubId, sid]
  );

  return ok(rows.map(r => {
    const totalRevenue = Math.round(Number(r.total_revenue) / 100); // cents → dollars
    return {
      ageGroup: r.age_group,
      playerCount: r.player_count,
      totalRevenue,
      avgRevenuePerPlayer: r.player_count > 0 ? Math.round(totalRevenue / r.player_count) : 0,
    };
  }));
};
