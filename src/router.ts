import type { RouteHandler, LambdaEvent } from './types.js';
import { notFound } from './lib/response.js';
import { healthHandler } from './routes/health.js';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface Route {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
}

const routes: Route[] = [
  { method: 'GET', path: '/health', handler: healthHandler },
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
