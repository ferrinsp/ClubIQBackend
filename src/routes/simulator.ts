import type { RouteHandler } from '../types.js';
import { ok, badRequest } from '../lib/response.js';
import { extractAuth, isAuthError } from '../middleware/auth.js';
import { getSeasonBaseline } from '../services/revenue.service.js';
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

  const result = await getSeasonBaseline(auth.clubId, seasonId);
  if (!result) return badRequest('Season not found');

  const { baseline } = result;
  const { totalPlayers: currentPlayers, totalRevenue: currentSeasonRevenue, avgTuition, avgRosterSize, teamCount } = baseline;

  // Calculations
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
