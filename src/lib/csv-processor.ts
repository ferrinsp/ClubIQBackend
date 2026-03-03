import pg from 'pg';
import {
  REQUIRED_COLUMNS,
  validateRosterRow,
  validatePaymentRow,
  type RowError,
  type RowWarning,
} from './csv-schemas.js';
import { parseCsv } from './csv-parser.js';
import { buildBatchValues, BATCH_SIZE } from './batch-insert.js';
import { findOrCreatePlayer, normalizedPlayerId } from '../repositories/player.repository.js';
import { findOrCreateTeam, findOrCreateSeason } from '../repositories/team.repository.js';

export interface ProcessResult {
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  errors: RowError[];
  warnings: RowWarning[];
}

/**
 * Validate CSV preamble: stripped columns, required headers, empty check, row limit.
 * Returns early-exit ProcessResult if validation fails, null if OK.
 */
function validateCsvPreamble(
  headers: string[],
  rows: Record<string, string>[],
  strippedColumns: string[],
  requiredColumns: string[],
  warnings: RowWarning[],
): ProcessResult | null {
  if (strippedColumns.length > 0) {
    warnings.push({ row_number: 0, type: 'column_stripped', message: `Unrecognized columns ignored: ${strippedColumns.join(', ')}` });
  }

  const missing = requiredColumns.filter(c => !headers.includes(c));
  if (missing.length > 0) {
    return {
      totalRows: 0, successfulRows: 0, failedRows: 0,
      errors: [{ row_number: 0, column: 'headers', value: '', message: `Missing required columns: ${missing.join(', ')}` }],
      warnings: [],
    };
  }

  if (rows.length === 0) {
    return {
      totalRows: 0, successfulRows: 0, failedRows: 0,
      errors: [{ row_number: 0, column: '', value: '', message: 'File contains no data rows' }],
      warnings: [],
    };
  }

  if (rows.length > 10000) {
    return {
      totalRows: rows.length, successfulRows: 0, failedRows: rows.length,
      errors: [{ row_number: 0, column: '', value: '', message: 'File exceeds maximum of 10,000 rows' }],
      warnings: [],
    };
  }

  return null;
}

export async function processRosterCsv(
  csvText: string,
  clubId: string,
  seasonId: string,
  client: pg.PoolClient,
): Promise<ProcessResult> {
  const { headers, rows, strippedColumns } = parseCsv(csvText);
  const errors: RowError[] = [];
  const warnings: RowWarning[] = [];

  const earlyExit = validateCsvPreamble(headers, rows, strippedColumns, REQUIRED_COLUMNS.roster, warnings);
  if (earlyExit) return earlyExit;

  const pendingInserts: [string, string, string, string][] = [];
  const seenRows = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const { row, errors: rowErrors } = validateRosterRow(rows[i], rowNum);

    if (rowErrors.length > 0) { errors.push(...rowErrors); continue; }
    if (!row) continue;

    const rowKey = `${row.first_name.toLowerCase()}|${row.last_name.toLowerCase()}|${row.birth_year}|${row.team.toLowerCase()}`;
    if (seenRows.has(rowKey)) {
      warnings.push({ row_number: rowNum, type: 'duplicate_row', message: `Row ${rowNum}: duplicate of earlier row (${row.first_name} ${row.last_name}, ${row.team})` });
      continue;
    }
    seenRows.add(rowKey);

    try {
      const match = await findOrCreatePlayer(client, clubId, row);

      if (match.matchType === 'fuzzy_name') {
        const pct = Math.round((match.similarity ?? 0) * 100);
        const multiNote = match.multipleCandidates ? ' (multiple candidates found)' : '';
        warnings.push({
          row_number: rowNum,
          type: match.multipleCandidates ? 'multiple_fuzzy_matches' : 'fuzzy_match',
          message: `Row ${rowNum}: matched to existing player via fuzzy name match (${pct}% similar)${multiNote}`,
          matched_player_id: match.playerId,
        });
      }

      const teamId = await findOrCreateTeam(client, clubId, seasonId, row);
      pendingInserts.push([match.playerId, seasonId, teamId, row.status]);
    } catch (err) {
      errors.push({ row_number: rowNum, column: '', value: '', message: `Row ${rowNum}: database error — ${(err as Error).message}` });
    }
  }

  let successful = 0;
  for (let i = 0; i < pendingInserts.length; i += BATCH_SIZE) {
    const batch = pendingInserts.slice(i, i + BATCH_SIZE);
    const { clause, params } = buildBatchValues(batch);
    await client.query(
      `INSERT INTO player_seasons (player_id, season_id, team_id, status)
       VALUES ${clause}
       ON CONFLICT (player_id, season_id) DO UPDATE SET team_id = EXCLUDED.team_id, status = EXCLUDED.status, updated_at = now()`,
      params
    );
    successful += batch.length;
  }

  return { totalRows: rows.length, successfulRows: successful, failedRows: rows.length - successful, errors, warnings };
}

export async function processPaymentCsv(
  csvText: string,
  clubId: string,
  seasonId: string,
  client: pg.PoolClient,
): Promise<ProcessResult> {
  const { headers, rows, strippedColumns } = parseCsv(csvText);
  const errors: RowError[] = [];
  const warnings: RowWarning[] = [];

  const earlyExit = validateCsvPreamble(headers, rows, strippedColumns, REQUIRED_COLUMNS.payment, warnings);
  if (earlyExit) return earlyExit;

  const pendingInserts: [string, string, string, number, string, string][] = [];
  const seenRows = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const { row, errors: rowErrors } = validatePaymentRow(rows[i], rowNum);

    if (rowErrors.length > 0) { errors.push(...rowErrors); continue; }
    if (!row) continue;

    const idPart = row.player_id ?? `${(row.first_name ?? '').toLowerCase()}|${(row.last_name ?? '').toLowerCase()}|${row.birth_year ?? ''}`;
    const rowKey = `${idPart}|${row.amount}|${row.payment_date}`;
    if (seenRows.has(rowKey)) {
      warnings.push({ row_number: rowNum, type: 'duplicate_row', message: `Row ${rowNum}: duplicate payment row` });
      continue;
    }
    seenRows.add(rowKey);

    try {
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
            normalized_id = $2 OR
            (lower(first_name) = lower($3) AND lower(last_name) = lower($4) AND birth_year = $5)
          )`,
          [clubId, normalized, row.first_name, row.last_name, row.birth_year]
        );
        if (found.length > 0) playerId = found[0].id;
      }

      if (!playerId) {
        errors.push({ row_number: rowNum, column: 'player_id', value: row.player_id ?? '(no external ID)', message: `Row ${rowNum}: player not found — upload a roster CSV first` });
        continue;
      }

      pendingInserts.push([clubId, playerId, seasonId, row.amount, row.payment_date, row.status]);
    } catch (err) {
      errors.push({ row_number: rowNum, column: '', value: '', message: `Row ${rowNum}: database error — ${(err as Error).message}` });
    }
  }

  let successful = 0;
  for (let i = 0; i < pendingInserts.length; i += BATCH_SIZE) {
    const batch = pendingInserts.slice(i, i + BATCH_SIZE);
    const { clause, params } = buildBatchValues(batch);
    await client.query(
      `INSERT INTO payments (club_id, player_id, season_id, amount, type, paid_date, status)
       SELECT v.club_id, v.player_id, v.season_id, v.amount, 'tuition', v.paid_date::date, v.status
       FROM (VALUES ${clause}) AS v(club_id, player_id, season_id, amount, paid_date, status)`,
      params
    );
    successful += batch.length;
  }

  return { totalRows: rows.length, successfulRows: successful, failedRows: rows.length - successful, errors, warnings };
}

export async function processHistoricalRosterCsv(
  csvText: string,
  clubId: string,
  client: pg.PoolClient,
): Promise<ProcessResult> {
  const { headers, rows, strippedColumns } = parseCsv(csvText);
  const errors: RowError[] = [];
  const warnings: RowWarning[] = [];

  const earlyExit = validateCsvPreamble(headers, rows, strippedColumns, REQUIRED_COLUMNS.historical_roster, warnings);
  if (earlyExit) return earlyExit;

  const seasonGroups = new Map<string, { raw: Record<string, string>; rowNum: number }[]>();
  for (let i = 0; i < rows.length; i++) {
    const seasonName = rows[i].season?.trim();
    if (!seasonName) {
      errors.push({ row_number: i + 2, column: 'season', value: '', message: `Row ${i + 2}: season is required for historical roster` });
      continue;
    }
    if (!seasonGroups.has(seasonName)) seasonGroups.set(seasonName, []);
    seasonGroups.get(seasonName)!.push({ raw: rows[i], rowNum: i + 2 });
  }

  let successful = 0;

  for (const [seasonName, groupRows] of seasonGroups) {
    const seasonId = await findOrCreateSeason(client, clubId, seasonName);

    for (const { raw, rowNum } of groupRows) {
      const { row, errors: rowErrors } = validateRosterRow(raw, rowNum);
      if (rowErrors.length > 0) { errors.push(...rowErrors); continue; }
      if (!row) continue;

      try {
        const match = await findOrCreatePlayer(client, clubId, row);

        if (match.matchType === 'fuzzy_name') {
          const pct = Math.round((match.similarity ?? 0) * 100);
          const multiNote = match.multipleCandidates ? ' (multiple candidates found)' : '';
          warnings.push({
            row_number: rowNum,
            type: match.multipleCandidates ? 'multiple_fuzzy_matches' : 'fuzzy_match',
            message: `Row ${rowNum}: matched to existing player via fuzzy name match (${pct}% similar)${multiNote}`,
            matched_player_id: match.playerId,
          });
        }

        const teamId = await findOrCreateTeam(client, clubId, seasonId, row);

        await client.query(
          `INSERT INTO player_seasons (player_id, season_id, team_id, status)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (player_id, season_id) DO UPDATE SET team_id = $3, status = $4, updated_at = now()`,
          [match.playerId, seasonId, teamId, row.status]
        );

        successful++;
      } catch (err) {
        errors.push({ row_number: rowNum, column: '', value: '', message: `Row ${rowNum}: database error — ${(err as Error).message}` });
      }
    }
  }

  return { totalRows: rows.length, successfulRows: successful, failedRows: rows.length - successful, errors, warnings };
}
