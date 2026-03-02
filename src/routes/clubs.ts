import type { RouteHandler } from '../types.js';
import { ok, badRequest, notFound } from '../lib/response.js';
import { query } from '../db.js';
import { extractAuth, isAuthError } from '../middleware/auth.js';
import { z } from 'zod';

const updateClubSchema = z.object({
  name: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
});

/**
 * GET /clubs/me
 * Returns the authenticated club's profile.
 */
export const getClubHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const { rows } = await query<{
    id: string;
    name: string;
    subdomain: string | null;
    state: string | null;
    created_at: string;
    updated_at: string;
  }>(
    'SELECT id, name, subdomain, state, created_at, updated_at FROM clubs WHERE id = $1',
    [auth.clubId]
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
    createdAt: club.created_at,
    updatedAt: club.updated_at,
  });
};

/**
 * PUT /clubs/me
 * Updates the authenticated club's profile.
 */
export const updateClubHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

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
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE clubs SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING id, name, subdomain, state, created_at, updated_at`,
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
    createdAt: club.created_at,
    updatedAt: club.updated_at,
  });
};
