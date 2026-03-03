import type pg from 'pg';
import { pool } from '../db.js';

export interface ResolvedSeason {
  id: string;
  name: string;
}

/**
 * Resolve a season by ID, or fall back to the club's current season.
 */
export async function resolveSeason(
  clubId: string,
  seasonId?: string,
  client?: pg.Pool | pg.PoolClient,
): Promise<ResolvedSeason | null> {
  const db = client ?? pool;
  const query = seasonId
    ? 'SELECT id, name FROM seasons WHERE id = $1 AND club_id = $2'
    : 'SELECT id, name FROM seasons WHERE club_id = $1 AND is_current = true';
  const params = seasonId ? [seasonId, clubId] : [clubId];
  const { rows } = await db.query(query, params);
  return rows[0] ?? null;
}

/**
 * Get the most recent season that ended before the given season started.
 */
export async function getPreviousSeason(
  clubId: string,
  seasonId: string,
  client?: pg.Pool | pg.PoolClient,
): Promise<string | null> {
  const db = client ?? pool;
  const { rows } = await db.query(
    `SELECT id FROM seasons WHERE club_id = $1
     AND end_date < (SELECT start_date FROM seasons WHERE id = $2)
     ORDER BY end_date DESC LIMIT 1`,
    [clubId, seasonId],
  );
  return rows[0]?.id ?? null;
}

/**
 * Resolve season + previous season in one call.
 */
export async function resolveSeasonPair(
  clubId: string,
  seasonId?: string,
  client?: pg.Pool | pg.PoolClient,
): Promise<{ season: ResolvedSeason; prevSeasonId: string | null } | null> {
  const season = await resolveSeason(clubId, seasonId, client);
  if (!season) return null;
  const prevSeasonId = await getPreviousSeason(clubId, season.id, client);
  return { season, prevSeasonId };
}
