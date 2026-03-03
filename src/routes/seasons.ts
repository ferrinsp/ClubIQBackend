import type { RouteHandler } from '../types.js';
import { ok } from '../lib/response.js';
import { pool } from '../db.js';
import { extractAuth, isAuthError } from '../middleware/auth.js';

/**
 * GET /seasons
 * Returns all seasons for the authenticated club.
 */
export const listSeasonsHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const { rows } = await pool.query(
    'SELECT id, name, is_current FROM seasons WHERE club_id = $1 ORDER BY start_date DESC',
    [auth.clubId]
  );

  return ok(rows.map(r => ({
    id: r.id,
    name: r.name,
    isCurrent: r.is_current,
  })));
};
