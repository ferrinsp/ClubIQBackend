import type { RouteHandler } from '../types.js';
import { ok, badRequest } from '../lib/response.js';
import { query } from '../db.js';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /auth/login
 * Mock login: validates credentials shape, looks up club by subdomain/email,
 * returns a mock token. Real Cognito auth comes in Phase F.
 */
export const loginHandler: RouteHandler = async (event) => {
  const body = JSON.parse(event.body ?? '{}');
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Invalid email or password format');
  }

  // In dev mode, find first club and return mock auth
  const { rows } = await query<{ id: string; name: string }>(
    'SELECT id, name FROM clubs LIMIT 1'
  );

  if (rows.length === 0) {
    return badRequest('No clubs found. Run the seed script first.');
  }

  const club = rows[0];

  return ok({
    token: `dev-token-${club.id}`,
    refreshToken: `dev-refresh-${club.id}`,
    expiresIn: 3600,
    club: {
      id: club.id,
      name: club.name,
    },
    user: {
      id: 'dev-user',
      email: parsed.data.email,
      role: 'admin',
    },
  });
};

/**
 * POST /auth/refresh
 * Mock token refresh. Returns a new mock token.
 */
export const refreshHandler: RouteHandler = async (event) => {
  const body = JSON.parse(event.body ?? '{}');
  if (!body.refreshToken) {
    return badRequest('Missing refreshToken');
  }

  return ok({
    token: `dev-token-refreshed-${Date.now()}`,
    refreshToken: `dev-refresh-${Date.now()}`,
    expiresIn: 3600,
  });
};
