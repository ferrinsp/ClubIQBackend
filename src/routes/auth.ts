import crypto from 'node:crypto';
import type { RouteHandler } from '../types.js';
import { ok, created, badRequest } from '../lib/response.js';
import { query, pool } from '../db.js';
import { extractAuth, isAuthError, requireRole } from '../middleware/auth.js';
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
    accessToken: `dev-token-${club.id}`,
    idToken: `dev-id-${club.id}`,
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
  if (!body.refreshToken && !body.refresh_token) {
    return badRequest('Missing refresh_token');
  }

  return ok({
    accessToken: `dev-token-refreshed-${Date.now()}`,
    idToken: `dev-id-refreshed-${Date.now()}`,
    refreshToken: `dev-refresh-${Date.now()}`,
    expiresIn: 3600,
  });
};

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  clubName: z.string().min(1),
});

/**
 * POST /auth/signup
 * Creates a new club + default season and returns mock auth tokens.
 */
export const signupHandler: RouteHandler = async (event) => {
  const body = JSON.parse(event.body ?? '{}');
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Email, password (min 8 chars), and clubName are required');
  }

  const { email, clubName } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create club
    const { rows: clubRows } = await client.query(
      `INSERT INTO clubs (name, primary_contact_email) VALUES ($1, $2) RETURNING id, name`,
      [clubName, email]
    );
    const club = clubRows[0];

    // Create default season
    const year = new Date().getFullYear();
    await client.query(
      `INSERT INTO seasons (club_id, name, start_date, end_date, is_current)
       VALUES ($1, $2, $3, $4, true)`,
      [club.id, `${year}-${year + 1}`, `${year}-08-01`, `${year + 1}-06-30`]
    );

    await client.query('COMMIT');

    return created({
      userId: 'dev-user',
      clubId: club.id,
      email,
      role: 'admin',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'viewer']),
});

/**
 * POST /auth/invite
 * Admin-only: creates an invitation for a new team member.
 */
export const inviteHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, 'admin');
  if (roleCheck) return roleCheck;

  const body = JSON.parse(event.body ?? '{}');
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Valid email and role (admin or viewer) are required');
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const { rows: invRows } = await query<{ id: string }>(
    `INSERT INTO invitations (club_id, email, role, token, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [auth.clubId, parsed.data.email, parsed.data.role, token, expiresAt.toISOString()]
  );

  return created({
    invitationId: invRows[0].id,
    email: parsed.data.email,
    role: parsed.data.role,
    status: 'pending',
    expiresAt: expiresAt.toISOString(),
  });
};
