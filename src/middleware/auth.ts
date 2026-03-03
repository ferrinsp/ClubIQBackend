import type { LambdaEvent, LambdaResult } from '../types.js';
import { err } from '../lib/response.js';

export interface AuthContext {
  clubId: string;
  userId: string;
  role: string;
}

/**
 * Extract auth context from the request.
 * In development: reads X-Club-Id and X-User-Id headers (mock auth).
 * In production: will verify Cognito JWT and extract custom claims.
 */
export function extractAuth(event: LambdaEvent): AuthContext | LambdaResult {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const clubId = event.headers['x-club-id'];
    if (!clubId) {
      return err(401, 'UNAUTHORIZED', 'Missing X-Club-Id header');
    }
    return {
      clubId,
      userId: event.headers['x-user-id'] ?? 'dev-user',
      role: event.headers['x-role'] ?? 'admin',
    };
  }

  // Production: JWT verification (Phase F - Cognito integration)
  const authHeader = event.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return err(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header');
  }

  // TODO: Verify JWT with Cognito, extract custom:club_id and custom:role
  return err(501, 'NOT_IMPLEMENTED', 'JWT verification not yet implemented');
}

export function isAuthError(result: AuthContext | LambdaResult): result is LambdaResult {
  return 'statusCode' in result;
}

export function requireRole(auth: AuthContext, ...roles: string[]): LambdaResult | null {
  if (!roles.includes(auth.role)) {
    return err(403, 'FORBIDDEN', `This action requires one of: ${roles.join(', ')}`);
  }
  return null;
}
