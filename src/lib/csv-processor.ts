import crypto from 'node:crypto';
import pg from 'pg';
import {
  REQUIRED_COLUMNS,
  validateRosterRow,
  validatePaymentRow,
  type RosterRow,
  type PaymentRow,
  type RowError,
  type RowWarning,
} from './csv-schemas.js';

export interface ProcessResult {
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  errors: RowError[];
  warnings: RowWarning[];
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip UTF-8 BOM
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0);

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

function normalizedPlayerId(firstName: string, lastName: string, birthYear: number): string {
  const input = `${firstName.toLowerCase().trim()}|${lastName.toLowerCase().trim()}|${birthYear}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export async function processRosterCsv(
  csvText: string,
  clubId: string,
  seasonId: string,
  client: pg.PoolClient,
): Promise<ProcessResult> {
  const { headers, rows } = parseCsv(csvText);
  const errors: RowError[] = [];
  const warnings: RowWarning[] = [];

  // Validate headers
  const missing = REQUIRED_COLUMNS.roster.filter(c => !headers.includes(c));
  if (missing.length > 0) {
    return {
      totalRows: 0,
      successfulRows: 0,
      failedRows: 0,
      errors: [{ row_number: 0, column: 'headers', value: '', message: `Missing required columns: ${missing.join(', ')}` }],
      warnings: [],
    };
  }

  if (rows.length > 10000) {
    return {
      totalRows: rows.length,
      successfulRows: 0,
      failedRows: rows.length,
      errors: [{ row_number: 0, column: '', value: '', message: 'File exceeds maximum of 10,000 rows' }],
      warnings: [],
    };
  }

  let successful = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // 1-indexed, skip header
    const { row, errors: rowErrors } = validateRosterRow(rows[i], rowNum);

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    if (!row) continue;

    try {
      // Find or create player
      const playerId = await findOrCreatePlayer(client, clubId, row);

      // Find or create team
      const teamId = await findOrCreateTeam(client, clubId, seasonId, row);

      // Upsert player_season
      await client.query(
        `INSERT INTO player_seasons (player_id, season_id, team_id, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (player_id, season_id) DO UPDATE SET team_id = $3, status = $4, updated_at = now()`,
        [playerId, seasonId, teamId, row.status]
      );

      successful++;
    } catch (err) {
      errors.push({
        row_number: rowNum,
        column: '',
        value: '',
        message: `Row ${rowNum}: database error — ${(err as Error).message}`,
      });
    }
  }

  return {
    totalRows: rows.length,
    successfulRows: successful,
    failedRows: rows.length - successful,
    errors,
    warnings,
  };
}

export async function processPaymentCsv(
  csvText: string,
  clubId: string,
  seasonId: string,
  client: pg.PoolClient,
): Promise<ProcessResult> {
  const { headers, rows } = parseCsv(csvText);
  const errors: RowError[] = [];
  const warnings: RowWarning[] = [];

  const missing = REQUIRED_COLUMNS.payment.filter(c => !headers.includes(c));
  if (missing.length > 0) {
    return {
      totalRows: 0,
      successfulRows: 0,
      failedRows: 0,
      errors: [{ row_number: 0, column: 'headers', value: '', message: `Missing required columns: ${missing.join(', ')}` }],
      warnings: [],
    };
  }

  if (rows.length > 10000) {
    return {
      totalRows: rows.length,
      successfulRows: 0,
      failedRows: rows.length,
      errors: [{ row_number: 0, column: '', value: '', message: 'File exceeds maximum of 10,000 rows' }],
      warnings: [],
    };
  }

  let successful = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const { row, errors: rowErrors } = validatePaymentRow(rows[i], rowNum);

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    if (!row) continue;

    try {
      // Find player
      let playerId: string | null = null;

      if (row.player_id) {
        const { rows: found } = await client.query(
          'SELECT id FROM players WHERE club_id = $1 AND external_id = $2',
          [clubId, row.player_id]
        );
        if (found.length > 0) playerId = found[0].id;
      }

      if (!playerId && row.first_name && row.last_name && row.birth_year) {
        const normalized = normalizedPlayerId(row.first_name, row.last_name, row.birth_year);
        const { rows: found } = await client.query(
          `SELECT id FROM players WHERE club_id = $1 AND (
            external_id = $2 OR
            (lower(first_name) = lower($3) AND lower(last_name) = lower($4) AND birth_year = $5)
          )`,
          [clubId, normalized, row.first_name, row.last_name, row.birth_year]
        );
        if (found.length > 0) playerId = found[0].id;
      }

      if (!playerId) {
        errors.push({
          row_number: rowNum,
          column: 'player_id',
          value: row.player_id ?? `${row.first_name} ${row.last_name}`,
          message: `Row ${rowNum}: player not found — upload a roster CSV first`,
        });
        continue;
      }

      // Insert payment
      await client.query(
        `INSERT INTO payments (club_id, player_id, season_id, amount, type, paid_date, status)
         VALUES ($1, $2, $3, $4, 'tuition', $5, $6)`,
        [clubId, playerId, seasonId, row.amount, row.payment_date, row.status]
      );

      successful++;
    } catch (err) {
      errors.push({
        row_number: rowNum,
        column: '',
        value: '',
        message: `Row ${rowNum}: database error — ${(err as Error).message}`,
      });
    }
  }

  return {
    totalRows: rows.length,
    successfulRows: successful,
    failedRows: rows.length - successful,
    errors,
    warnings,
  };
}

async function findOrCreatePlayer(
  client: pg.PoolClient,
  clubId: string,
  row: RosterRow,
): Promise<string> {
  const normalId = normalizedPlayerId(row.first_name, row.last_name, row.birth_year);

  // 1. Try exact external_id match
  if (row.player_id) {
    const { rows } = await client.query(
      'SELECT id FROM players WHERE club_id = $1 AND external_id = $2',
      [clubId, row.player_id]
    );
    if (rows.length > 0) return rows[0].id;
  }

  // 2. Try normalized ID match (name + birth_year)
  const { rows: nameMatch } = await client.query(
    `SELECT id FROM players WHERE club_id = $1
     AND lower(first_name) = lower($2) AND lower(last_name) = lower($3) AND birth_year = $4`,
    [clubId, row.first_name, row.last_name, row.birth_year]
  );
  if (nameMatch.length > 0) return nameMatch[0].id;

  // 3. Create new player
  const { rows: created } = await client.query(
    `INSERT INTO players (club_id, external_id, first_name, last_name, birth_year, gender)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [clubId, row.player_id ?? normalId, row.first_name, row.last_name, row.birth_year, row.gender]
  );
  return created[0].id;
}

async function findOrCreateTeam(
  client: pg.PoolClient,
  clubId: string,
  seasonId: string,
  row: RosterRow,
): Promise<string> {
  // Try exact name match for this season
  const { rows } = await client.query(
    'SELECT id FROM teams WHERE club_id = $1 AND season_id = $2 AND lower(name) = lower($3)',
    [clubId, seasonId, row.team]
  );
  if (rows.length > 0) return rows[0].id;

  // Create new team
  const { rows: created } = await client.query(
    `INSERT INTO teams (club_id, season_id, name, age_group, gender, competitive_level, tuition_amount)
     VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING id`,
    [clubId, seasonId, row.team, row.team.match(/U\d+/)?.[0] ?? 'Unknown', row.gender, row.level]
  );
  return created[0].id;
}
