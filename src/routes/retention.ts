import type { RouteHandler } from '../types.js';
import { ok, badRequest } from '../lib/response.js';
import { pool } from '../db.js';
import { extractAuth, isAuthError } from '../middleware/auth.js';
import { parsePagination, buildPaginationMeta } from '../lib/pagination.js';
import { resolveSeasonPair } from '../repositories/season.repository.js';
import { getClubRetentionMetrics, getRetentionRate, buildRetentionFilters, GROUP_BY_MAP, VALID_GROUP_BYS } from '../repositories/retention.repository.js';
import { getSeasonStats, getSeasonRevenue } from '../repositories/stats.repository.js';

/**
 * GET /retention/summary
 * Club-wide retention KPIs for a given season.
 */
export const retentionSummaryHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const pair = await resolveSeasonPair(auth.clubId, event.queryStringParameters?.seasonId);
  if (!pair) return badRequest('Season not found');
  const { season, prevSeasonId } = pair;

  const { totalPlayers } = await getSeasonStats(auth.clubId, season.id);
  const currentSeasonRevenue = await getSeasonRevenue(auth.clubId, season.id);

  let returning = 0, prevTotal = 0, graduated = 0, churned = 0;
  if (prevSeasonId) {
    const metrics = await getClubRetentionMetrics(auth.clubId, prevSeasonId, season.id);
    prevTotal = metrics.prevTotal;
    returning = metrics.returning;
    graduated = metrics.graduated;
    churned = metrics.churned;
  }

  const overallRetention = prevTotal > 0 ? Math.round((returning / prevTotal) * 1000) / 10 : 0;

  return ok({
    season: { id: season.id, name: season.name },
    totalPlayers,
    overallRetention,
    totalReturning: returning,
    totalChurned: churned,
    totalGraduated: graduated,
    previousSeasonPlayers: prevTotal,
    currentSeasonRevenue,
  });
};

/**
 * GET /retention/cohorts
 * Retention rates grouped by a configurable dimension.
 */
export const retentionCohortsHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const qs = event.queryStringParameters ?? {};
  const groupBy = qs.group_by ?? 'age_group';

  if (!VALID_GROUP_BYS.includes(groupBy)) {
    return badRequest(`group_by must be one of: ${VALID_GROUP_BYS.join(', ')}`);
  }
  const gb = GROUP_BY_MAP[groupBy];

  const pair = await resolveSeasonPair(auth.clubId, qs.seasonId);
  if (!pair) return badRequest('Season not found');
  const { season, prevSeasonId } = pair;

  if (!prevSeasonId) return ok([]);

  const baseParams = [auth.clubId, prevSeasonId, season.id];
  const { whereClause, params, nextParamIdx, needsPlayerJoin } = buildRetentionFilters(baseParams, {
    gender: qs.gender,
    level: qs.level,
    birthYear: qs.birth_year ? parseInt(qs.birth_year, 10) : undefined,
  });

  const playerJoin = (groupBy === 'birth_year' || needsPlayerJoin) ? 'JOIN players p ON p.id = prev.player_id' : '';

  const baseFrom = `FROM player_seasons prev
     JOIN teams t ON t.id = prev.team_id AND t.club_id = $1
     ${playerJoin}
     LEFT JOIN player_seasons curr ON curr.player_id = prev.player_id AND curr.season_id = $3
     WHERE prev.season_id = $2 ${whereClause}`;

  const { page, perPage, offset } = parsePagination(event);

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
     LIMIT $${nextParamIdx} OFFSET $${nextParamIdx + 1}`,
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
 */
export const retentionTeamsHandler: RouteHandler = async (event) => {
  const auth = extractAuth(event);
  if (isAuthError(auth)) return auth;

  const qs = event.queryStringParameters ?? {};

  const pair = await resolveSeasonPair(auth.clubId, qs.seasonId);
  if (!pair) return badRequest('Season not found');
  const { season, prevSeasonId } = pair;

  if (!prevSeasonId) return ok([]);

  const baseParams = [auth.clubId, prevSeasonId, season.id];
  const { whereClause, params, nextParamIdx, needsPlayerJoin } = buildRetentionFilters(baseParams, {
    gender: qs.gender,
    level: qs.level,
    birthYear: qs.birth_year ? parseInt(qs.birth_year, 10) : undefined,
  });

  const playerJoin = needsPlayerJoin ? 'JOIN players p ON p.id = prev.player_id' : '';
  const { page, perPage, offset } = parsePagination(event);

  const baseFrom = `FROM teams t
     JOIN player_seasons prev ON prev.team_id = t.id AND prev.season_id = $2
     ${playerJoin}
     LEFT JOIN player_seasons curr ON curr.player_id = prev.player_id AND curr.season_id = $3
     WHERE t.club_id = $1 AND t.season_id = $2 ${whereClause}`;

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
     LIMIT $${nextParamIdx} OFFSET $${nextParamIdx + 1}`,
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

  const { rows: seasons } = await pool.query(
    'SELECT id, name, start_date FROM seasons WHERE club_id = $1 ORDER BY start_date',
    [auth.clubId]
  );

  if (seasons.length < 2) return ok([]);

  const trends = [];

  for (let i = 1; i < seasons.length; i++) {
    const prevSeason = seasons[i - 1];
    const currSeason = seasons[i];

    const { prevTotal, returning } = await getRetentionRate(auth.clubId, prevSeason.id, currSeason.id);

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
