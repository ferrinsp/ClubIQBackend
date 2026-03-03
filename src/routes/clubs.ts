import type { RouteHandler } from '../types.js';
import { ok, badRequest, notFound } from '../lib/response.js';
import { query, pool } from '../db.js';
import { extractAuth, isAuthError, requireRole } from '../middleware/auth.js';
import { z } from 'zod';

const updateClubSchema = z.object({
  name: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  primaryContactEmail: z.string().email().optional(),
});

/**
 * GET /clubs/profile (alias: /clubs/me)
 * Returns the authenticated club's profile with computed fields.
 */
export const getClubHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const { rows } = await query<{
    id: string;
    name: string;
    subdomain: string | null;
    state: string | null;
    city: string | null;
    primary_contact_email: string | null;
    created_at: string;
    updated_at: string;
  }>(
    'SELECT id, name, subdomain, state, city, primary_contact_email, created_at, updated_at FROM clubs WHERE id = $1',
    [auth.clubId]
  );

  if (rows.length === 0) {
    return notFound('Club not found');
  }

  const club = rows[0];

  // Get computed fields from teams table
  const { rows: teamMeta } = await pool.query(
    `SELECT
       array_agg(DISTINCT age_group ORDER BY age_group) FILTER (WHERE age_group IS NOT NULL) as age_groups,
       array_agg(DISTINCT competitive_level ORDER BY competitive_level) FILTER (WHERE competitive_level IS NOT NULL) as competitive_levels
     FROM teams WHERE club_id = $1`,
    [auth.clubId]
  );

  return ok({
    id: club.id,
    name: club.name,
    subdomain: club.subdomain,
    state: club.state,
    city: club.city,
    primaryContactEmail: club.primary_contact_email,
    ageGroups: teamMeta[0]?.age_groups ?? [],
    competitiveLevels: teamMeta[0]?.competitive_levels ?? [],
    createdAt: club.created_at,
    updatedAt: club.updated_at,
  });
};

/**
 * PUT /clubs/profile (alias: /clubs/me)
 * Admin-only: updates the authenticated club's profile.
 */
export const updateClubHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, 'admin');
  if (roleCheck) return roleCheck;

  const body = JSON.parse(event.body ?? '{}');
  const parsed = updateClubSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Invalid club data');
  }

  const updates = parsed.data;
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }
  if (updates.state !== undefined) {
    setClauses.push(`state = $${paramIndex++}`);
    values.push(updates.state);
  }
  if (updates.city !== undefined) {
    setClauses.push(`city = $${paramIndex++}`);
    values.push(updates.city);
  }
  if (updates.primaryContactEmail !== undefined) {
    setClauses.push(`primary_contact_email = $${paramIndex++}`);
    values.push(updates.primaryContactEmail);
  }

  if (setClauses.length === 0) {
    return badRequest('No fields to update');
  }

  setClauses.push(`updated_at = now()`);
  values.push(auth.clubId);

  const { rows } = await query<{
    id: string;
    name: string;
    subdomain: string | null;
    state: string | null;
    city: string | null;
    primary_contact_email: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE clubs SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
     RETURNING id, name, subdomain, state, city, primary_contact_email, created_at, updated_at`,
    values
  );

  if (rows.length === 0) {
    return notFound('Club not found');
  }

  const club = rows[0];
  return ok({
    id: club.id,
    name: club.name,
    subdomain: club.subdomain,
    state: club.state,
    city: club.city,
    primaryContactEmail: club.primary_contact_email,
    createdAt: club.created_at,
    updatedAt: club.updated_at,
  });
};
