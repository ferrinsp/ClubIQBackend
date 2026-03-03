import type { RouteHandler } from '../types.js';
import { ok, badRequest } from '../lib/response.js';
import { pool } from '../db.js';
import { extractAuth, isAuthError } from '../middleware/auth.js';
import { parsePagination, buildPaginationMeta } from '../lib/pagination.js';

/**
 * GET /retention/summary
 * Club-wide retention KPIs for a given season.
 * Query params: seasonId (optional, defaults to current season)
 */
export const retentionSummaryHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const seasonId = event.queryStringParameters?.seasonId;

  // Get current or specified season
  const seasonQuery = seasonId
    ? 'SELECT id, name FROM seasons WHERE id = $1 AND club_id = $2'
    : 'SELECT id, name FROM seasons WHERE club_id = $1 AND is_current = true';
  const seasonParams = seasonId ? [seasonId, auth.clubId] : [auth.clubId];
  const { rows: seasonRows } = await pool.query(seasonQuery, seasonParams);

  if (seasonRows.length === 0) return badRequest('Season not found');
  const season = seasonRows[0];

  // Get previous season
  const { rows: prevRows } = await pool.query(
    `SELECT id FROM seasons WHERE club_id = $1 AND end_date < (SELECT start_date FROM seasons WHERE id = $2)
     ORDER BY end_date DESC LIMIT 1`,
    [auth.clubId, season.id]
  );
  const prevSeasonId = prevRows[0]?.id;

  // Total players in current season
  const { rows: currentCount } = await pool.query(
    `SELECT count(DISTINCT ps.player_id)::int as total
     FROM player_seasons ps
     JOIN teams t ON t.id = ps.team_id
     WHERE t.club_id = $1 AND ps.season_id = $2`,
    [auth.clubId, season.id]
  );

  // Retention: players in both current and previous season
  let returning = 0;
  let prevTotal = 0;
  let graduated = 0;
  let churned = 0;

  if (prevSeasonId) {
    const { rows: retentionRows } = await pool.query(
      `SELECT
         count(DISTINCT prev.player_id)::int as prev_total,
         count(DISTINCT CASE WHEN curr.player_id IS NOT NULL THEN prev.player_id END)::int as returning,
         count(DISTINCT CASE WHEN prev.status = 'graduated' THEN prev.player_id END)::int as graduated,
         count(DISTINCT CASE WHEN curr.player_id IS NULL AND prev.status != 'graduated' THEN prev.player_id END)::int as churned
       FROM player_seasons prev
       JOIN teams t ON t.id = prev.team_id AND t.club_id = $1
       LEFT JOIN player_seasons curr ON curr.player_id = prev.player_id AND curr.season_id = $3
       WHERE prev.season_id = $2`,
      [auth.clubId, prevSeasonId, season.id]
    );
    prevTotal = retentionRows[0].prev_total;
    returning = retentionRows[0].returning;
    graduated = retentionRows[0].graduated;
    churned = retentionRows[0].churned;
  }

  // Current season revenue
  const { rows: revenueRows } = await pool.query(
    `SELECT coalesce(sum(amount), 0)::int as total_revenue
     FROM payments WHERE club_id = $1 AND season_id = $2 AND status = 'paid'`,
    [auth.clubId, season.id]
  );

  const totalPlayers = currentCount[0].total;
  const overallRetention = prevTotal > 0 ? Math.round((returning / prevTotal) * 1000) / 10 : 0;

  return ok({
    season: { id: season.id, name: season.name },
    totalPlayers,
    overallRetention,
    totalReturning: returning,
    totalChurned: churned,
    totalGraduated: graduated,
    previousSeasonPlayers: prevTotal,
    currentSeasonRevenue: Math.round(revenueRows[0].total_revenue / 100),
  });
};

/**
 * GET /retention/cohorts
 * Retention rates grouped by a configurable dimension.
 * Query params: seasonId, gender, level, birth_year, group_by (age_group|team|birth_year|level|gender)
 */
export const retentionCohortsHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const qs = event.queryStringParameters ?? {};
  const seasonId = qs.seasonId;
  const gender = qs.gender;
  const level = qs.level;
  const birthYear = qs.birth_year ? parseInt(qs.birth_year, 10) : undefined;
  const groupBy = qs.group_by ?? 'age_group';

  const validGroupBys = ['age_group', 'team', 'birth_year', 'level', 'gender'];
  if (!validGroupBys.includes(groupBy)) {
    return badRequest(`group_by must be one of: ${validGroupBys.join(', ')}`);
  }

  // Map group_by value to SQL expression
  const groupByMap: Record<string, { select: string; groupCol: string; label: string }> = {
    age_group: { select: 't.age_group', groupCol: 't.age_group', label: 'age_group' },
    team: { select: 't.name', groupCol: 't.name', label: 'team' },
    birth_year: { select: 'p.birth_year::text', groupCol: 'p.birth_year', label: 'birth_year' },
    level: { select: 't.competitive_level', groupCol: 't.competitive_level', label: 'level' },
    gender: { select: 't.gender', groupCol: 't.gender', label: 'gender' },
  };
  const gb = groupByMap[groupBy];

  // Get current or specified season
  const seasonQuery = seasonId
    ? 'SELECT id FROM seasons WHERE id = $1 AND club_id = $2'
    : 'SELECT id FROM seasons WHERE club_id = $1 AND is_current = true';
  const seasonParams = seasonId ? [seasonId, auth.clubId] : [auth.clubId];
  const { rows: seasonRows } = await pool.query(seasonQuery, seasonParams);
  if (seasonRows.length === 0) return badRequest('Season not found');
  const currentSeasonId = seasonRows[0].id;

  // Get previous season
  const { rows: prevRows } = await pool.query(
    `SELECT id FROM seasons WHERE club_id = $1 AND end_date < (SELECT start_date FROM seasons WHERE id = $2)
     ORDER BY end_date DESC LIMIT 1`,
    [auth.clubId, currentSeasonId]
  );
  const prevSeasonId = prevRows[0]?.id;

  if (!prevSeasonId) {
    return ok([]);
  }

  // Build filter conditions
  const filters: string[] = [];
  const params: unknown[] = [auth.clubId, prevSeasonId, currentSeasonId];
  let paramIdx = 4;

  if (gender) {
    filters.push(`t.gender = $${paramIdx++}`);
    params.push(gender);
  }
  if (level) {
    filters.push(`t.competitive_level = $${paramIdx++}`);
    params.push(level);
  }
  if (birthYear && !isNaN(birthYear)) {
    filters.push(`p.birth_year = $${paramIdx++}`);
    params.push(birthYear);
  }

  const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';

  const { page, perPage, offset } = parsePagination(event);

  // Need to join players table for birth_year grouping/filtering
  const needsPlayerJoin = groupBy === 'birth_year' || birthYear;
  const playerJoin = needsPlayerJoin ? 'JOIN players p ON p.id = prev.player_id' : '';

  const baseFrom = `FROM player_seasons prev
     JOIN teams t ON t.id = prev.team_id AND t.club_id = $1
     ${playerJoin}
     LEFT JOIN player_seasons curr ON curr.player_id = prev.player_id AND curr.season_id = $3
     WHERE prev.season_id = $2 ${whereClause}`;

  // Count total groups
  const { rows: countRows } = await pool.query(
    `SELECT count(*) ::int as total FROM (SELECT 1 ${baseFrom} GROUP BY ${gb.groupCol}) sub`,
    params
  );
  const total = countRows[0].total;

  const { rows } = await pool.query(
    `SELECT
       ${gb.select} as group_key,
       count(DISTINCT prev.player_id)::int as total_players,
       count(DISTINCT CASE WHEN curr.player_id IS NOT NULL THEN prev.player_id END)::int as returning,
       count(DISTINCT CASE WHEN prev.status = 'graduated' THEN prev.player_id END)::int as graduated,
       count(DISTINCT CASE WHEN curr.player_id IS NULL AND prev.status != 'graduated' THEN prev.player_id END)::int as churned
     ${baseFrom}
     GROUP BY ${gb.groupCol}
     ORDER BY ${gb.groupCol}
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, perPage, offset]
  );

  const cohorts = rows.map(r => ({
    groupKey: r.group_key,
    groupBy,
    totalPlayers: r.total_players,
    returning: r.returning,
    graduated: r.graduated,
    churned: r.churned,
    retentionRate: r.total_players > 0
      ? Math.round((r.returning / r.total_players) * 1000) / 10
      : 0,
  }));

  return ok(cohorts, buildPaginationMeta(page, perPage, total));
};

/**
 * GET /retention/teams
 * Team-level retention breakdown.
 * Query params: seasonId, gender, level
 */
export const retentionTeamsHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const qs = event.queryStringParameters ?? {};
  const seasonId = qs.seasonId;
  const gender = qs.gender;
  const level = qs.level;
  const birthYear = qs.birth_year ? parseInt(qs.birth_year, 10) : undefined;

  const seasonQuery = seasonId
    ? 'SELECT id FROM seasons WHERE id = $1 AND club_id = $2'
    : 'SELECT id FROM seasons WHERE club_id = $1 AND is_current = true';
  const seasonParams = seasonId ? [seasonId, auth.clubId] : [auth.clubId];
  const { rows: seasonRows } = await pool.query(seasonQuery, seasonParams);
  if (seasonRows.length === 0) return badRequest('Season not found');
  const currentSeasonId = seasonRows[0].id;

  const { rows: prevRows } = await pool.query(
    `SELECT id FROM seasons WHERE club_id = $1 AND end_date < (SELECT start_date FROM seasons WHERE id = $2)
     ORDER BY end_date DESC LIMIT 1`,
    [auth.clubId, currentSeasonId]
  );
  const prevSeasonId = prevRows[0]?.id;

  if (!prevSeasonId) {
    return ok([]);
  }

  const filters: string[] = [];
  const params: unknown[] = [auth.clubId, prevSeasonId, currentSeasonId];
  let paramIdx = 4;

  if (gender) {
    filters.push(`t.gender = $${paramIdx++}`);
    params.push(gender);
  }
  if (level) {
    filters.push(`t.competitive_level = $${paramIdx++}`);
    params.push(level);
  }

  // birth_year filter requires joining players table
  const needsPlayerJoin = birthYear && !isNaN(birthYear);
  if (needsPlayerJoin) {
    filters.push(`p.birth_year = $${paramIdx++}`);
    params.push(birthYear);
  }
  const playerJoin = needsPlayerJoin ? 'JOIN players p ON p.id = prev.player_id' : '';

  const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
  const { page, perPage, offset } = parsePagination(event);

  const baseFrom = `FROM teams t
     JOIN player_seasons prev ON prev.team_id = t.id AND prev.season_id = $2
     ${playerJoin}
     LEFT JOIN player_seasons curr ON curr.player_id = prev.player_id AND curr.season_id = $3
     WHERE t.club_id = $1 AND t.season_id = $2 ${whereClause}`;

  // Count total teams
  const { rows: countRows } = await pool.query(
    `SELECT count(DISTINCT t.id)::int as total ${baseFrom}`,
    params
  );
  const total = countRows[0].total;

  const { rows } = await pool.query(
    `SELECT
       t.id as team_id,
       t.name as team_name,
       t.age_group,
       t.gender,
       t.competitive_level,
       t.coach_name,
       count(DISTINCT prev.player_id)::int as player_count,
       count(DISTINCT CASE WHEN curr.player_id IS NOT NULL THEN prev.player_id END)::int as returning,
       count(DISTINCT CASE WHEN prev.status = 'graduated' THEN prev.player_id END)::int as graduated,
       count(DISTINCT CASE WHEN curr.player_id IS NULL AND prev.status != 'graduated' THEN prev.player_id END)::int as churned
     ${baseFrom}
     GROUP BY t.id, t.name, t.age_group, t.gender, t.competitive_level, t.coach_name
     ORDER BY t.age_group, t.name
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, perPage, offset]
  );

  const teams = rows.map(r => ({
    teamId: r.team_id,
    teamName: r.team_name,
    ageGroup: r.age_group,
    gender: r.gender,
    level: r.competitive_level,
    coachName: r.coach_name,
    playerCount: r.player_count,
    returning: r.returning,
    graduated: r.graduated,
    churned: r.churned,
    retentionRate: r.player_count > 0
      ? Math.round((r.returning / r.player_count) * 1000) / 10
      : 0,
  }));

  return ok(teams, buildPaginationMeta(page, perPage, total));
};

/**
 * GET /retention/trends
 * Multi-season retention trend data with age-group breakdowns.
 */
export const retentionTrendsHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  // Get all seasons ordered by start date
  const { rows: seasons } = await pool.query(
    'SELECT id, name, start_date FROM seasons WHERE club_id = $1 ORDER BY start_date',
    [auth.clubId]
  );

  if (seasons.length < 2) {
    return ok([]);
  }

  const trends = [];

  for (let i = 1; i < seasons.length; i++) {
    const prevSeason = seasons[i - 1];
    const currSeason = seasons[i];

    // Overall retention
    const { rows } = await pool.query(
      `SELECT
         count(DISTINCT prev.player_id)::int as prev_total,
         count(DISTINCT CASE WHEN curr.player_id IS NOT NULL THEN prev.player_id END)::int as returning
       FROM player_seasons prev
       JOIN teams t ON t.id = prev.team_id AND t.club_id = $1
       LEFT JOIN player_seasons curr ON curr.player_id = prev.player_id AND curr.season_id = $3
       WHERE prev.season_id = $2`,
      [auth.clubId, prevSeason.id, currSeason.id]
    );

    // Age-group breakdown for U10-U12 and U13-U15
    const { rows: ageRows } = await pool.query(
      `SELECT
         t.age_group,
         count(DISTINCT prev.player_id)::int as prev_total,
         count(DISTINCT CASE WHEN curr.player_id IS NOT NULL THEN prev.player_id END)::int as returning
       FROM player_seasons prev
       JOIN teams t ON t.id = prev.team_id AND t.club_id = $1
       LEFT JOIN player_seasons curr ON curr.player_id = prev.player_id AND curr.season_id = $3
       WHERE prev.season_id = $2
       GROUP BY t.age_group`,
      [auth.clubId, prevSeason.id, currSeason.id]
    );

    const prevTotal = rows[0].prev_total;
    const returning = rows[0].returning;

    // Aggregate U10-U12 and U13-U15
    const u10u12Groups = ['U10', 'U11', 'U12'];
    const u13u15Groups = ['U13', 'U14', 'U15'];

    let u10u12Prev = 0, u10u12Ret = 0;
    let u13u15Prev = 0, u13u15Ret = 0;

    for (const r of ageRows) {
      if (u10u12Groups.includes(r.age_group)) {
        u10u12Prev += r.prev_total;
        u10u12Ret += r.returning;
      }
      if (u13u15Groups.includes(r.age_group)) {
        u13u15Prev += r.prev_total;
        u13u15Ret += r.returning;
      }
    }

    trends.push({
      seasonId: currSeason.id,
      seasonName: currSeason.name,
      previousSeasonPlayers: prevTotal,
      returningPlayers: returning,
      retentionRate: prevTotal > 0
        ? Math.round((returning / prevTotal) * 1000) / 10
        : 0,
      u10u12: u10u12Prev > 0
        ? Math.round((u10u12Ret / u10u12Prev) * 1000) / 10
        : 0,
      u13u15: u13u15Prev > 0
        ? Math.round((u13u15Ret / u13u15Prev) * 1000) / 10
        : 0,
    });
  }

  return ok(trends);
};
