import type { RouteHandler } from '../types.js';
import { ok, badRequest } from '../lib/response.js';
import { pool } from '../db.js';
import { extractAuth, isAuthError } from '../middleware/auth.js';
import { resolveSeason } from '../repositories/season.repository.js';
import { getSeasonBaseline } from '../services/revenue.service.js';

/**
 * GET /revenue/forecast
 * Returns base, optimistic, and pessimistic revenue scenarios.
 */
export const revenueForecastHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const result = await getSeasonBaseline(auth.clubId, event.queryStringParameters?.seasonId);
  if (!result) return badRequest('Season not found');

  const { baseline, seasonName } = result;
  const { totalPlayers, totalRevenue, avgTuition, retentionRate } = baseline;

  // Base scenario: current retention rate
  const baseReturning = Math.round(totalPlayers * (retentionRate / 100));
  const baseRevenue = baseReturning * avgTuition;

  // High: +5% retention
  const highRate = Math.min(100, retentionRate + 5);
  const highReturning = Math.round(totalPlayers * (highRate / 100));
  const highRevenue = highReturning * avgTuition;

  // Low: -5% retention
  const lowRate = Math.max(0, retentionRate - 5);
  const lowReturning = Math.round(totalPlayers * (lowRate / 100));
  const lowRevenue = lowReturning * avgTuition;

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
      high: {
        label: 'High',
        retentionRate: highRate,
        projectedPlayers: highReturning,
        projectedRevenue: highRevenue,
        revenueChange: highRevenue - totalRevenue,
        revenueChangePct: totalRevenue > 0 ? Math.round(((highRevenue - totalRevenue) / totalRevenue) * 1000) / 10 : 0,
      },
      low: {
        label: 'Low',
        retentionRate: lowRate,
        projectedPlayers: lowReturning,
        projectedRevenue: lowRevenue,
        revenueChange: lowRevenue - totalRevenue,
        revenueChangePct: totalRevenue > 0 ? Math.round(((lowRevenue - totalRevenue) / totalRevenue) * 1000) / 10 : 0,
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

  const season = await resolveSeason(auth.clubId, event.queryStringParameters?.seasonId);
  if (!season) return badRequest('Season not found');

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
    [auth.clubId, season.id]
  );

  return ok(rows.map(r => {
    const totalRevenue = Math.round(Number(r.total_revenue) / 100);
    return {
      ageGroup: r.age_group,
      playerCount: r.player_count,
      totalRevenue,
      avgRevenuePerPlayer: r.player_count > 0 ? Math.round(totalRevenue / r.player_count) : 0,
    };
  }));
};
