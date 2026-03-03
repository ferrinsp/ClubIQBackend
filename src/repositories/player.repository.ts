import crypto from 'node:crypto';
import type pg from 'pg';
import type { RosterRow } from '../lib/csv-schemas.js';

export interface PlayerMatchResult {
  playerId: string;
  matchType: 'external_id' | 'exact_name' | 'fuzzy_name' | 'created';
  similarity?: number;
  multipleCandidates?: boolean;
}

const FUZZY_SIMILARITY_THRESHOLD = 0.7;

export function normalizedPlayerId(firstName: string, lastName: string, birthYear: number): string {
  const input = `${firstName.toLowerCase().trim()}|${lastName.toLowerCase().trim()}|${birthYear}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * 5-step player matching: external_id → normalized_id → exact name → fuzzy → create.
 */
export async function findOrCreatePlayer(
  client: pg.PoolClient,
  clubId: string,
  row: RosterRow,
): Promise<PlayerMatchResult> {
  const normalId = normalizedPlayerId(row.first_name, row.last_name, row.birth_year);

  // 1. Try exact external_id match
  if (row.player_id) {
    const { rows } = await client.query(
      'SELECT id FROM players WHERE club_id = $1 AND external_id = $2',
      [clubId, row.player_id]
    );
    if (rows.length > 0) return { playerId: rows[0].id, matchType: 'external_id' };
  }

  // 2. Try normalized_id match
  const { rows: normalMatch } = await client.query(
    'SELECT id FROM players WHERE club_id = $1 AND normalized_id = $2',
    [clubId, normalId]
  );
  if (normalMatch.length > 0) return { playerId: normalMatch[0].id, matchType: 'exact_name' };

  // 3. Try exact name + birth_year match
  const { rows: nameMatch } = await client.query(
    `SELECT id FROM players WHERE club_id = $1
     AND lower(first_name) = lower($2) AND lower(last_name) = lower($3) AND birth_year = $4`,
    [clubId, row.first_name, row.last_name, row.birth_year]
  );
  if (nameMatch.length > 0) return { playerId: nameMatch[0].id, matchType: 'exact_name' };

  // 4. Try fuzzy name match (pg_trgm) with same birth_year
  const { rows: fuzzyMatch } = await client.query(
    `SELECT id, first_name, last_name,
            similarity(first_name, $2) AS fn_sim,
            similarity(last_name, $3) AS ln_sim,
            (similarity(first_name, $2) + similarity(last_name, $3)) / 2.0 AS avg_sim
     FROM players
     WHERE club_id = $1 AND birth_year = $4
       AND similarity(first_name, $2) > $5
       AND similarity(last_name, $3) > $5
     ORDER BY avg_sim DESC
     LIMIT 5`,
    [clubId, row.first_name, row.last_name, row.birth_year, FUZZY_SIMILARITY_THRESHOLD]
  );
  if (fuzzyMatch.length > 0) {
    return {
      playerId: fuzzyMatch[0].id,
      matchType: 'fuzzy_name',
      similarity: parseFloat(fuzzyMatch[0].avg_sim),
      multipleCandidates: fuzzyMatch.length > 1,
    };
  }

  // 5. Create new player
  const { rows: created } = await client.query(
    `INSERT INTO players (club_id, external_id, normalized_id, first_name, last_name, birth_year, gender)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [clubId, row.player_id ?? normalId, normalId, row.first_name, row.last_name, row.birth_year, row.gender]
  );
  return { playerId: created[0].id, matchType: 'created' };
}
