import type { RouteHandler, LambdaResult } from '../types.js';
import { extractAuth, isAuthError } from '../middleware/auth.js';
import { ok, setRequestOrigin } from '../lib/response.js';
import { parsePagination, buildPaginationMeta } from '../lib/pagination.js';
import { pool } from '../db.js';

export const getPlayersHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const qs = event.queryStringParameters ?? {};
  const { page, perPage, offset } = parsePagination(event);

  // Build dynamic WHERE clause
  const conditions = ['p.club_id = $1'];
  const params: (string | number)[] = [auth.clubId];
  let paramIdx = 2;

  if (qs.season_id) {
    conditions.push(`ps.season_id = $${paramIdx}`);
    params.push(qs.season_id);
    paramIdx++;
  }

  if (qs.status) {
    conditions.push(`ps.status = $${paramIdx}`);
    params.push(qs.status);
    paramIdx++;
  }

  if (qs.gender) {
    conditions.push(`p.gender = $${paramIdx}`);
    params.push(qs.gender);
    paramIdx++;
  }

  if (qs.age_group) {
    conditions.push(`t.age_group = $${paramIdx}`);
    params.push(qs.age_group);
    paramIdx++;
  }

  if (qs.team_id) {
    conditions.push(`ps.team_id = $${paramIdx}`);
    params.push(qs.team_id);
    paramIdx++;
  }

  if (qs.search) {
    conditions.push(`(p.first_name ILIKE $${paramIdx} OR p.last_name ILIKE $${paramIdx})`);
    params.push(`%${qs.search}%`);
    paramIdx++;
  }

  const where = conditions.join(' AND ');

  const baseFrom = `FROM players p
    JOIN player_seasons ps ON ps.player_id = p.id
    JOIN teams t ON t.id = ps.team_id
    WHERE ${where}`;

  // Count total
  const { rows: countRows } = await pool.query(
    `SELECT count(DISTINCT p.id)::int as total ${baseFrom}`,
    params,
  );
  const total = countRows[0].total;

  // Fetch page
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (p.id)
      p.id,
      p.first_name,
      p.last_name,
      p.birth_year,
      p.gender,
      t.name as team_name,
      t.age_group,
      t.competitive_level as level,
      ps.status,
      t.coach_name
    ${baseFrom}
    ORDER BY p.id, ps.created_at DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, perPage, offset],
  );

  return ok(
    rows.map(r => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      birthYear: r.birth_year,
      gender: r.gender,
      teamName: r.team_name,
      ageGroup: r.age_group,
      level: r.level,
      status: r.status,
      coachName: r.coach_name,
    })),
    buildPaginationMeta(page, perPage, total),
  );
};

export const exportPlayersHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const qs = event.queryStringParameters ?? {};
  const seasonFilter = qs.season_id ? 'AND ps.season_id = $2' : '';
  const params: string[] = [auth.clubId];
  if (qs.season_id) params.push(qs.season_id);

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (p.id)
      p.first_name, p.last_name, p.birth_year, p.gender,
      t.name as team_name, t.age_group, t.competitive_level as level,
      ps.status, t.coach_name
    FROM players p
    JOIN player_seasons ps ON ps.player_id = p.id
    JOIN teams t ON t.id = ps.team_id
    WHERE p.club_id = $1 ${seasonFilter}
    ORDER BY p.id, ps.created_at DESC`,
    params,
  );

  const header = 'first_name,last_name,birth_year,gender,team_name,age_group,level,status,coach_name';
  const csvRows = rows.map(r => {
    const escape = (v: string | number | null) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [r.first_name, r.last_name, r.birth_year, r.gender, r.team_name, r.age_group, r.level, r.status, r.coach_name].map(escape).join(',');
  });

  const csv = [header, ...csvRows].join('\n');

  const origin = event.headers?.origin ?? 'http://localhost:5173';
  setRequestOrigin(origin);

  const result: LambdaResult = {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="players_export.csv"',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Club-Id',
      'Vary': 'Origin',
    },
    body: csv,
  };
  return result;
};
