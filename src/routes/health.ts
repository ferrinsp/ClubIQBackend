import type { RouteHandler } from '../types.js';
import { ok } from '../lib/response.js';
import { healthCheck } from '../db.js';

export const healthHandler: RouteHandler = async () => {
  const dbHealthy = await healthCheck();
  return ok({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: dbHealthy,
  });
};
