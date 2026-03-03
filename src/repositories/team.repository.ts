import type pg from 'pg';
import type { RosterRow } from '../lib/csv-schemas.js';

/**
 * Find or create a team for the given season.
 */
export async function findOrCreateTeam(
  client: pg.PoolClient,
  clubId: string,
  seasonId: string,
  row: RosterRow,
): Promise<string> {
  const { rows } = await client.query(
    'SELECT id FROM teams WHERE club_id = $1 AND season_id = $2 AND lower(name) = lower($3)',
    [clubId, seasonId, row.team]
  );
  if (rows.length > 0) return rows[0].id;

  const { rows: created } = await client.query(
    `INSERT INTO teams (club_id, season_id, name, age_group, gender, competitive_level, tuition_amount)
     VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING id`,
    [clubId, seasonId, row.team, row.team.match(/U\d+/)?.[0] ?? 'Unknown', row.gender, row.level]
  );
  return created[0].id;
}

/**
 * Find or create a season by name (used by historical roster processing).
 */
export async function findOrCreateSeason(
  client: pg.PoolClient,
  clubId: string,
  seasonName: string,
): Promise<string> {
  const { rows } = await client.query(
    'SELECT id FROM seasons WHERE club_id = $1 AND lower(name) = lower($2)',
    [clubId, seasonName]
  );
  if (rows.length > 0) return rows[0].id;

  const yearMatch = seasonName.match(/(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

  const { rows: created } = await client.query(
    `INSERT INTO seasons (club_id, name, start_date, end_date, is_current)
     VALUES ($1, $2, $3, $4, false) RETURNING id`,
    [clubId, seasonName, `${year}-08-01`, `${year + 1}-06-30`]
  );
  return created[0].id;
}
