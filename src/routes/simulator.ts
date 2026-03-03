import type { RouteHandler } from '../types.js';
import { ok, badRequest } from '../lib/response.js';
import { pool } from '../db.js';
import { extractAuth, isAuthError } from '../middleware/auth.js';
import { z } from 'zod';

const simulatorInputSchema = z.object({
  retentionRate: z.number().min(0).max(100),
  feeChangePct: z.number().min(-50).max(50),
  teamCountChange: z.number().int().min(-20).max(20),
  scholarshipBudget: z.number().min(0),
  newPlayerRecruitment: z.number().int().min(0).max(500),
  seasonId: z.string().uuid().optional(),
});

/**
 * POST /simulator/calculate
 * Accepts slider inputs, returns revenue projections.
 * Matches the calculation logic in prototype/src/hooks/useSimulator.ts
 */
export const simulatorCalculateHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const body = JSON.parse(event.body ?? '{}');
  const parsed = simulatorInputSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Invalid simulator inputs');
  }

  const { retentionRate, feeChangePct, teamCountChange, scholarshipBudget, newPlayerRecruitment, seasonId } = parsed.data;

  // Get baseline data from database
  const seasonQuery = seasonId
    ? 'SELECT id FROM seasons WHERE id = $1 AND club_id = $2'
    : 'SELECT id FROM seasons WHERE club_id = $1 AND is_current = true';
  const seasonParams = seasonId ? [seasonId, auth.clubId] : [auth.clubId];
  const { rows: seasonRows } = await pool.query(seasonQuery, seasonParams);
  if (seasonRows.length === 0) return badRequest('Season not found');
  const sid = seasonRows[0].id;

  // Get current season stats
  const { rows: stats } = await pool.query(
    `SELECT
       count(DISTINCT ps.player_id)::int as total_players,
       count(DISTINCT t.id)::int as team_count
     FROM player_seasons ps
     JOIN teams t ON t.id = ps.team_id AND t.club_id = $1
     WHERE ps.season_id = $2`,
    [auth.clubId, sid]
  );

  const { rows: revenueRows } = await pool.query(
    `SELECT coalesce(sum(amount), 0)::bigint as total_revenue
     FROM payments WHERE club_id = $1 AND season_id = $2 AND status = 'paid'`,
    [auth.clubId, sid]
  );

  const currentPlayers = stats[0].total_players;
  const teamCount = stats[0].team_count;
  const currentSeasonRevenue = Math.round(Number(revenueRows[0].total_revenue) / 100); // cents → dollars
  const avgTuition = currentPlayers > 0 ? Math.round(currentSeasonRevenue / currentPlayers) : 0;
  const avgRosterSize = teamCount > 0 ? Math.round(currentPlayers / teamCount) : 19;

  // Calculations (matching useSimulator.ts exactly)
  const projectedReturning = Math.round(currentPlayers * (retentionRate / 100));

  const newTeamPlayers = teamCountChange > 0
    ? teamCountChange * avgRosterSize
    : 0;

  const removedTeamPlayers = teamCountChange < 0
    ? Math.abs(teamCountChange) * avgRosterSize
    : 0;

  const totalProjectedPlayers = projectedReturning + newTeamPlayers + newPlayerRecruitment - removedTeamPlayers;

  const adjustedTuition = avgTuition * (1 + feeChangePct / 100);

  const grossRevenue = totalProjectedPlayers * adjustedTuition;
  const netRevenue = grossRevenue - scholarshipBudget;

  const marginImpact = netRevenue - currentSeasonRevenue;
  const marginImpactPct = currentSeasonRevenue > 0
    ? Math.round((marginImpact / currentSeasonRevenue) * 1000) / 10
    : 0;

  const breakEvenNewPlayers = marginImpact < 0
    ? Math.ceil(Math.abs(marginImpact) / adjustedTuition)
    : 0;

  return ok({
    inputs: {
      retentionRate,
      feeChangePct,
      teamCountChange,
      scholarshipBudget,
      newPlayerRecruitment,
    },
    baseline: {
      currentPlayers,
      currentSeasonRevenue,
      avgTuitionPerPlayer: avgTuition,
      avgRosterSize,
      teamCount,
    },
    results: {
      projectedReturningPlayers: projectedReturning,
      newTeamPlayers: newTeamPlayers - removedTeamPlayers,
      totalProjectedPlayers,
      grossRevenue: Math.round(grossRevenue),
      scholarshipDeductions: scholarshipBudget,
      netRevenue: Math.round(netRevenue),
      currentSeasonRevenue,
      marginImpact: Math.round(marginImpact),
      marginImpactPct,
      breakEvenNewPlayers,
    },
  });
};
