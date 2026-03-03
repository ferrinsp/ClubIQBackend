import type { RouteHandler } from '../types.js';
import { ok, created, badRequest, notFound } from '../lib/response.js';
import { pool } from '../db.js';
import { extractAuth, isAuthError } from '../middleware/auth.js';
import { processRosterCsv, processPaymentCsv } from '../lib/csv-processor.js';
import { REQUIRED_COLUMNS } from '../lib/csv-schemas.js';
import { z } from 'zod';

const uploadSchema = z.object({
  fileType: z.enum(['roster', 'payment', 'historical_roster']),
  fileName: z.string().min(1),
  seasonId: z.string().uuid(),
  csvContent: z.string().min(1),
});

/**
 * POST /uploads
 * For local dev: accepts CSV content directly in the request body.
 * In production: this would return a presigned S3 URL instead.
 */
export const createUploadHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const body = JSON.parse(event.body ?? '{}');
  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    const missing = parsed.error.issues.map(i => i.path.join('.')).join(', ');
    return badRequest(`Invalid upload request. Check fields: ${missing}`);
  }

  const { fileType, fileName, seasonId, csvContent } = parsed.data;

  // Validate season exists
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_club_id', $1, true)", [auth.clubId]);

    const { rows: seasonRows } = await client.query(
      'SELECT id FROM seasons WHERE id = $1 AND club_id = $2',
      [seasonId, auth.clubId]
    );
    if (seasonRows.length === 0) {
      return badRequest('Season not found');
    }

    // Create upload record
    const { rows: uploadRows } = await client.query(
      `INSERT INTO uploads (club_id, file_type, file_name, status, total_rows)
       VALUES ($1, $2, $3, 'processing', 0) RETURNING id`,
      [auth.clubId, fileType, fileName]
    );
    const uploadId = uploadRows[0].id;

    // Process CSV
    let result;
    if (fileType === 'roster' || fileType === 'historical_roster') {
      result = await processRosterCsv(csvContent, auth.clubId, seasonId, client);
    } else {
      result = await processPaymentCsv(csvContent, auth.clubId, seasonId, client);
    }

    // Determine final status
    const status = result.failedRows === 0
      ? 'completed'
      : result.successfulRows === 0
        ? 'failed'
        : 'completed_with_errors';

    // Update upload record
    await client.query(
      `UPDATE uploads SET
         status = $1, total_rows = $2, successful_rows = $3, failed_rows = $4,
         errors = $5, updated_at = now()
       WHERE id = $6`,
      [status, result.totalRows, result.successfulRows, result.failedRows,
       JSON.stringify(result.errors), uploadId]
    );

    return created({
      uploadId,
      status,
      totalRows: result.totalRows,
      successfulRows: result.successfulRows,
      failedRows: result.failedRows,
      errors: result.errors,
      warnings: result.warnings,
    });
  } finally {
    client.release();
  }
};

/**
 * GET /uploads
 * Returns upload history for the authenticated club.
 */
export const listUploadsHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const { rows } = await pool.query(
    `SELECT id, file_type, file_name, status, total_rows, successful_rows, failed_rows, created_at, updated_at
     FROM uploads WHERE club_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [auth.clubId]
  );

  return ok(rows.map(r => ({
    id: r.id,
    fileType: r.file_type,
    fileName: r.file_name,
    status: r.status,
    totalRows: r.total_rows,
    successfulRows: r.successful_rows,
    failedRows: r.failed_rows,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })));
};

/**
 * GET /uploads/:id
 * Returns a single upload with full error details.
 */
export const getUploadHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  // Extract ID from path
  const uploadId = event.rawPath.split('/').pop();
  if (!uploadId) return badRequest('Missing upload ID');

  const { rows } = await pool.query(
    `SELECT id, file_type, file_name, status, total_rows, successful_rows, failed_rows, errors, created_at, updated_at
     FROM uploads WHERE id = $1 AND club_id = $2`,
    [uploadId, auth.clubId]
  );

  if (rows.length === 0) {
    return notFound('Upload not found');
  }

  const r = rows[0];
  return ok({
    id: r.id,
    fileType: r.file_type,
    fileName: r.file_name,
    status: r.status,
    totalRows: r.total_rows,
    successfulRows: r.successful_rows,
    failedRows: r.failed_rows,
    errors: r.errors ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
};
