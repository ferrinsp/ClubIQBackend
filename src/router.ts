import type { RouteHandler, LambdaEvent } from './types.js';
import { notFound } from './lib/response.js';
import { healthHandler } from './routes/health.js';
import { loginHandler, refreshHandler } from './routes/auth.js';
import { getClubHandler, updateClubHandler } from './routes/clubs.js';

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

  const route = routes.find(r => r.method === method && r.path === path);
  if (!route) {
    return Promise.resolve(notFound(`No route for ${method} ${path}`));
  }

  return route.handler(event);
}
