import type { RouteHandler, LambdaEvent, LambdaResult } from './types.js';
import { notFound, setRequestOrigin, err } from './lib/response.js';
import { healthHandler } from './routes/health.js';
import { loginHandler, refreshHandler, signupHandler, inviteHandler } from './routes/auth.js';
import { getClubHandler, updateClubHandler } from './routes/clubs.js';
import { createUploadHandler, listUploadsHandler, getUploadHandler } from './routes/uploads.js';
import { retentionSummaryHandler, retentionCohortsHandler, retentionTeamsHandler, retentionTrendsHandler } from './routes/retention.js';
import { revenueForecastHandler, revenueByAgeGroupHandler } from './routes/revenue.js';
import { simulatorCalculateHandler } from './routes/simulator.js';
import { listSeasonsHandler } from './routes/seasons.js';
import { getBillingHandler, getPlansHandler, createCheckoutHandler, createPortalHandler, webhookHandler } from './routes/billing.js';
import { getPlayersHandler, exportPlayersHandler } from './routes/players.js';
import { checkRateLimit, type RateLimitResult } from './middleware/rate-limiter.js';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface Route {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
}

const routes: Route[] = [
  { method: 'GET',  path: '/health',       handler: healthHandler },
  { method: 'POST', path: '/auth/login',   handler: loginHandler },
  { method: 'POST', path: '/auth/signup',  handler: signupHandler },
  { method: 'POST', path: '/auth/refresh', handler: refreshHandler },
  { method: 'POST', path: '/auth/invite',  handler: inviteHandler },

  // Spec-aligned paths
  { method: 'GET',  path: '/clubs/profile',                  handler: getClubHandler },
  { method: 'PUT',  path: '/clubs/profile',                  handler: updateClubHandler },
  { method: 'GET',  path: '/dashboard/retention',            handler: retentionSummaryHandler },
  { method: 'GET',  path: '/dashboard/retention/cohorts',    handler: retentionCohortsHandler },
  { method: 'GET',  path: '/dashboard/retention/teams',      handler: retentionTeamsHandler },
  { method: 'GET',  path: '/dashboard/retention/trends',     handler: retentionTrendsHandler },
  { method: 'GET',  path: '/dashboard/revenue',              handler: revenueForecastHandler },
  { method: 'GET',  path: '/dashboard/revenue/by-age-group', handler: revenueByAgeGroupHandler },

  // Legacy aliases (kept for backward compatibility)
  { method: 'GET',  path: '/clubs/me',     handler: getClubHandler },
  { method: 'PUT',  path: '/clubs/me',     handler: updateClubHandler },
  { method: 'GET',  path: '/retention/summary',     handler: retentionSummaryHandler },
  { method: 'GET',  path: '/retention/cohorts',     handler: retentionCohortsHandler },
  { method: 'GET',  path: '/retention/teams',       handler: retentionTeamsHandler },
  { method: 'GET',  path: '/retention/trends',      handler: retentionTrendsHandler },
  { method: 'GET',  path: '/revenue/forecast',      handler: revenueForecastHandler },
  { method: 'GET',  path: '/revenue/by-age-group',  handler: revenueByAgeGroupHandler },

  // Shared paths (same in old and new)
  { method: 'POST', path: '/uploads',               handler: createUploadHandler },
  { method: 'GET',  path: '/uploads',               handler: listUploadsHandler },
  { method: 'POST', path: '/simulator/calculate',   handler: simulatorCalculateHandler },
  { method: 'GET',  path: '/seasons',               handler: listSeasonsHandler },

  // Players
  { method: 'GET',  path: '/players',         handler: getPlayersHandler },
  { method: 'GET',  path: '/players/export',  handler: exportPlayersHandler },

  // Billing
  { method: 'GET',  path: '/billing',          handler: getBillingHandler },
  { method: 'GET',  path: '/billing/plans',    handler: getPlansHandler },
  { method: 'POST', path: '/billing/checkout', handler: createCheckoutHandler },
  { method: 'POST', path: '/billing/portal',   handler: createPortalHandler },
  { method: 'POST', path: '/billing/webhook',  handler: webhookHandler },
];

// Routes with path parameters (e.g., /uploads/:id)
const paramRoutes: Route[] = [
  { method: 'GET', path: '/uploads/', handler: getUploadHandler },
];

export function dispatch(event: LambdaEvent) {
  const method = event.requestContext.http.method.toUpperCase() as HttpMethod;
  const path = event.rawPath;

  // Set origin for CORS headers
  setRequestOrigin(event.headers?.origin);

  // Handle CORS preflight
  if (method === ('OPTIONS' as HttpMethod)) {
    return Promise.resolve({
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': event.headers?.origin ?? 'http://localhost:5173',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Club-Id',
        'Vary': 'Origin',
      },
      body: '',
    });
  }

  // Rate limiting: apply to authenticated routes (those with X-Club-Id)
  const clubId = event.headers['x-club-id'];
  let rateLimit: RateLimitResult | null = null;
  if (clubId) {
    rateLimit = checkRateLimit(clubId);
    if (!rateLimit.allowed) {
      const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
      const response = err(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests. Please try again later.');
      response.headers = {
        ...response.headers,
        'X-RateLimit-Limit': String(rateLimit.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
        'Retry-After': String(retryAfter),
      };
      return Promise.resolve(response);
    }
  }

  // Exact match first
  const route = routes.find(r => r.method === method && r.path === path);
  let result: Promise<LambdaResult>;
  if (route) {
    result = route.handler(event);
  } else {
    // Prefix match for parameterized routes (e.g., /uploads/abc-123)
    const paramRoute = paramRoutes.find(r => r.method === method && path.startsWith(r.path) && path !== r.path.slice(0, -1));
    if (paramRoute) {
      result = paramRoute.handler(event);
    } else {
      result = Promise.resolve(notFound(`No route for ${method} ${path}`));
    }
  }

  // Attach rate-limit headers to response
  if (rateLimit) {
    return result.then(response => {
      response.headers = {
        ...response.headers,
        'X-RateLimit-Limit': String(rateLimit!.limit),
        'X-RateLimit-Remaining': String(rateLimit!.remaining),
        'X-RateLimit-Reset': String(Math.ceil(rateLimit!.resetAt / 1000)),
      };
      return response;
    });
  }

  return result;
}
