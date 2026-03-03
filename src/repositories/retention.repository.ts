import { pool } from '../db.js';

export interface RetentionMetrics {
  prevTotal: number;
  returning: number;
  graduated: number;
  churned: number;
}

/**
 * Full retention breakdown between two seasons (returning, graduated, churned).
 */
export async function getClubRetentionMetrics(
  clubId: string,
  prevSeasonId: string,
  currentSeasonId: string,
): Promise<RetentionMetrics> {
  const { rows } = await pool.query(
    `SELECT
       count(DISTINCT prev.player_id)::int as prev_total,
       count(DISTINCT CASE WHEN curr.player_id IS NOT NULL THEN prev.player_id END)::int as returning,
       count(DISTINCT CASE WHEN prev.status = 'graduated' THEN prev.player_id END)::int as graduated,
       count(DISTINCT CASE WHEN curr.player_id IS NULL AND prev.status != 'graduated' THEN prev.player_id END)::int as churned
     FROM player_seasons prev
     JOIN teams t ON t.id = prev.team_id AND t.club_id = $1
     LEFT JOIN player_seasons curr ON curr.player_id = prev.player_id AND curr.season_id = $3
     WHERE prev.season_id = $2`,
    [clubId, prevSeasonId, currentSeasonId],
  );
  return {
    prevTotal: rows[0].prev_total,
    returning: rows[0].returning,
    graduated: rows[0].graduated,
    churned: rows[0].churned,
  };
}

/**
 * Retention rate only (no graduated/churned breakdown).
 */
export async function getRetentionRate(
  clubId: string,
  prevSeasonId: string,
  currentSeasonId: string,
): Promise<{ prevTotal: number; returning: number }> {
  const { rows } = await pool.query(
    `SELECT
       count(DISTINCT prev.player_id)::int as prev_total,
       count(DISTINCT CASE WHEN curr.player_id IS NOT NULL THEN prev.player_id END)::int as returning
     FROM player_seasons prev
     JOIN teams t ON t.id = prev.team_id AND t.club_id = $1
     LEFT JOIN player_seasons curr ON curr.player_id = prev.player_id AND curr.season_id = $3
     WHERE prev.season_id = $2`,
    [clubId, prevSeasonId, currentSeasonId],
  );
  return { prevTotal: rows[0].prev_total, returning: rows[0].returning };
}

export interface RetentionFilter {
  gender?: string;
  level?: string;
  birthYear?: number;
}

/**
 * Build WHERE clause fragments and params for gender/level/birthYear filters.
 */
export function buildRetentionFilters(
  baseParams: unknown[],
  filters: RetentionFilter,
): { whereClause: string; params: unknown[]; nextParamIdx: number; needsPlayerJoin: boolean } {
  const conditions: string[] = [];
  const params = [...baseParams];
  let paramIdx = baseParams.length + 1;

  if (filters.gender) {
    conditions.push(`t.gender = $${paramIdx++}`);
    params.push(filters.gender);
  }
  if (filters.level) {
    conditions.push(`t.competitive_level = $${paramIdx++}`);
    params.push(filters.level);
  }
  const needsPlayerJoin = !!(filters.birthYear && !isNaN(filters.birthYear));
  if (needsPlayerJoin) {
    conditions.push(`p.birth_year = $${paramIdx++}`);
    params.push(filters.birthYear);
  }

  return {
    whereClause: conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '',
    params,
    nextParamIdx: paramIdx,
    needsPlayerJoin,
  };
}

export const GROUP_BY_MAP: Record<string, { select: string; groupCol: string; label: string }> = {
  age_group: { select: 't.age_group', groupCol: 't.age_group', label: 'age_group' },
  team: { select: 't.name', groupCol: 't.name', label: 'team' },
  birth_year: { select: 'p.birth_year::text', groupCol: 'p.birth_year', label: 'birth_year' },
  level: { select: 't.competitive_level', groupCol: 't.competitive_level', label: 'level' },
  gender: { select: 't.gender', groupCol: 't.gender', label: 'gender' },
};

export const VALID_GROUP_BYS = Object.keys(GROUP_BY_MAP);
