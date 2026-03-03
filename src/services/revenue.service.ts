import { resolveSeasonPair } from '../repositories/season.repository.js';
import { getRetentionRate } from '../repositories/retention.repository.js';
import { getSeasonStats, getSeasonRevenue } from '../repositories/stats.repository.js';

export interface SeasonBaseline {
  totalPlayers: number;
  totalRevenue: number;
  avgTuition: number;
  avgRosterSize: number;
  retentionRate: number;
  teamCount: number;
}

export interface BaselineResult {
  baseline: SeasonBaseline;
  seasonId: string;
  seasonName: string;
  prevSeasonId: string | null;
}

/**
 * Shared baseline computation used by both revenue forecast and simulator.
 */
export async function getSeasonBaseline(
  clubId: string,
  seasonId?: string,
): Promise<BaselineResult | null> {
  const pair = await resolveSeasonPair(clubId, seasonId);
  if (!pair) return null;

  const { season, prevSeasonId } = pair;
  const stats = await getSeasonStats(clubId, season.id);
  const totalRevenue = await getSeasonRevenue(clubId, season.id);

  let retentionRate = 74; // default when no previous season
  if (prevSeasonId) {
    const ret = await getRetentionRate(clubId, prevSeasonId, season.id);
    if (ret.prevTotal > 0) {
      retentionRate = Math.round((ret.returning / ret.prevTotal) * 1000) / 10;
    }
  }

  const { totalPlayers, teamCount } = stats;
  const avgTuition = totalPlayers > 0 ? Math.round(totalRevenue / totalPlayers) : 0;
  const avgRosterSize = teamCount > 0 ? Math.round(totalPlayers / teamCount) : 19;

  return {
    baseline: { totalPlayers, totalRevenue, avgTuition, avgRosterSize, retentionRate, teamCount },
    seasonId: season.id,
    seasonName: season.name,
    prevSeasonId,
  };
}
