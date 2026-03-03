import type { RouteHandler } from '../types.js';
import { ok, created, badRequest, notFound, err } from '../lib/response.js';
import { pool } from '../db.js';
import { extractAuth, isAuthError } from '../middleware/auth.js';
import { processRosterCsv, processPaymentCsv, processHistoricalRosterCsv } from '../lib/csv-processor.js';
import { REQUIRED_COLUMNS } from '../lib/csv-schemas.js';
import { parsePagination, buildPaginationMeta } from '../lib/pagination.js';
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

  // Validate file extension
  if (!fileName.toLowerCase().endsWith('.csv')) {
    return badRequest('Only CSV files are supported', 'fileName');
  }

  // Validate file size (10MB limit)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (csvContent.length > MAX_SIZE) {
    return err(413, 'FILE_TOO_LARGE', 'File exceeds maximum size of 10MB');
  }

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
      `INSERT INTO uploads (club_id, file_type, file_name, status, total_rows, uploaded_by)
       VALUES ($1, $2, $3, 'processing', 0, $4) RETURNING id`,
      [auth.clubId, fileType, fileName, auth.userId]
    );
    const uploadId = uploadRows[0].id;

    // Process CSV
    let result;
    if (fileType === 'historical_roster') {
      result = await processHistoricalRosterCsv(csvContent, auth.clubId, client);
    } else if (fileType === 'roster') {
      result = await processRosterCsv(csvContent, auth.clubId, seasonId, client);
    } else {
      result = await processPaymentCsv(csvContent, auth.clubId, seasonId, client);
    }

    // Determine final status
    const status = result.errors.length > 0 && result.successfulRows === 0
      ? 'failed'
      : result.failedRows > 0
        ? 'completed_with_errors'
        : 'completed';

    // Update upload record with results, warnings, and audit info
    await client.query(
      `UPDATE uploads SET
         status = $1, total_rows = $2, successful_rows = $3, failed_rows = $4,
         errors = $5, warnings = $6, uploaded_by = $7, completed_at = now(), updated_at = now()
       WHERE id = $8`,
      [status, result.totalRows, result.successfulRows, result.failedRows,
       JSON.stringify(result.errors), JSON.stringify(result.warnings),
       auth.userId, uploadId]
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

  const { page, perPage, offset } = parsePagination(event);
  const qs = event.queryStringParameters ?? {};

  // Build optional filters
  const conditions = ['club_id = $1'];
  const params: (string | number)[] = [auth.clubId];
  let paramIdx = 2;

  if (qs.status) {
    conditions.push(`status = $${paramIdx}`);
    params.push(qs.status);
    paramIdx++;
  }
  if (qs.upload_type) {
    conditions.push(`file_type = $${paramIdx}`);
    params.push(qs.upload_type);
    paramIdx++;
  }

  const where = conditions.join(' AND ');

  // Count total
  const { rows: countRows } = await pool.query(`SELECT count(*)::int as total FROM uploads WHERE ${where}`, params);
  const total = countRows[0].total;

  // Fetch page
  const { rows } = await pool.query(
    `SELECT id, file_type, file_name, status, total_rows, successful_rows, failed_rows, completed_at, created_at, updated_at
     FROM uploads WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, perPage, offset]
  );

  return ok(
    rows.map(r => ({
      id: r.id,
      fileType: r.file_type,
      fileName: r.file_name,
      status: r.status,
      totalRows: r.total_rows,
      successfulRows: r.successful_rows,
      failedRows: r.failed_rows,
      completedAt: r.completed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    buildPaginationMeta(page, perPage, total),
  );
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
    `SELECT id, file_type, file_name, status, total_rows, successful_rows, failed_rows,
            errors, warnings, uploaded_by, completed_at, created_at, updated_at
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
    warnings: r.warnings ?? [],
    uploadedBy: r.uploaded_by,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
};
