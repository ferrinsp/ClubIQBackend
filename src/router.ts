import type { RouteHandler, LambdaEvent } from './types.js';
import { notFound } from './lib/response.js';
import { healthHandler } from './routes/health.js';
import { loginHandler, refreshHandler } from './routes/auth.js';
import { getClubHandler, updateClubHandler } from './routes/clubs.js';
import { createUploadHandler, listUploadsHandler, getUploadHandler } from './routes/uploads.js';
import { retentionSummaryHandler, retentionCohortsHandler, retentionTeamsHandler, retentionTrendsHandler } from './routes/retention.js';
import { revenueForecastHandler, revenueByAgeGroupHandler } from './routes/revenue.js';
import { simulatorCalculateHandler } from './routes/simulator.js';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface Route {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
}

const routes: Route[] = [
  { method: 'GET',  path: '/health',       handler: healthHandler },
  { method: 'POST', path: '/auth/login',   handler: loginHandler },
  { method: 'POST', path: '/auth/refresh', handler: refreshHandler },
  { method: 'GET',  path: '/clubs/me',     handler: getClubHandler },
  { method: 'PUT',  path: '/clubs/me',     handler: updateClubHandler },
  { method: 'POST', path: '/uploads',      handler: createUploadHandler },
  { method: 'GET',  path: '/uploads',      handler: listUploadsHandler },
  { method: 'GET',  path: '/retention/summary',  handler: retentionSummaryHandler },
  { method: 'GET',  path: '/retention/cohorts',  handler: retentionCohortsHandler },
  { method: 'GET',  path: '/retention/teams',    handler: retentionTeamsHandler },
  { method: 'GET',  path: '/retention/trends',   handler: retentionTrendsHandler },
  { method: 'GET',  path: '/revenue/forecast',      handler: revenueForecastHandler },
  { method: 'GET',  path: '/revenue/by-age-group',  handler: revenueByAgeGroupHandler },
  { method: 'POST', path: '/simulator/calculate',   handler: simulatorCalculateHandler },
];

// Routes with path parameters (e.g., /uploads/:id)
const paramRoutes: Route[] = [
  { method: 'GET', path: '/uploads/', handler: getUploadHandler },
];

export function dispatch(event: LambdaEvent) {
  const method = event.requestContext.http.method.toUpperCase() as HttpMethod;
  const path = event.rawPath;

  // Handle CORS preflight
  if (method === ('OPTIONS' as HttpMethod)) {
    return Promise.resolve({
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Club-Id',
      },
      body: '',
    });
  }

  // Exact match first
  const route = routes.find(r => r.method === method && r.path === path);
  if (route) return route.handler(event);

  // Prefix match for parameterized routes (e.g., /uploads/abc-123)
  const paramRoute = paramRoutes.find(r => r.method === method && path.startsWith(r.path) && path !== r.path.slice(0, -1));
  if (paramRoute) return paramRoute.handler(event);

  return Promise.resolve(notFound(`No route for ${method} ${path}`));
}
