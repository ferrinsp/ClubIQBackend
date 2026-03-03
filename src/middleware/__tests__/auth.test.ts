import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractAuth, isAuthError, requireRole, type AuthContext } from '../auth.js';
import type { LambdaEvent, LambdaResult } from '../../types.js';

function makeEvent(headers: Record<string, string> = {}): LambdaEvent {
  return {
    rawPath: '/test',
    requestContext: { http: { method: 'GET', path: '/test' } },
    headers,
  };
}

describe('extractAuth', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('development mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('returns auth context with X-Club-Id header', () => {
      const result = extractAuth(makeEvent({ 'x-club-id': 'club-123' }));
      expect(isAuthError(result)).toBe(false);
      const auth = result as AuthContext;
      expect(auth.clubId).toBe('club-123');
      expect(auth.userId).toBe('dev-user');
      expect(auth.role).toBe('admin');
    });

    it('uses X-User-Id and X-Role headers when provided', () => {
      const result = extractAuth(makeEvent({
        'x-club-id': 'club-123',
        'x-user-id': 'user-456',
        'x-role': 'viewer',
      }));
      const auth = result as AuthContext;
      expect(auth.userId).toBe('user-456');
      expect(auth.role).toBe('viewer');
    });

    it('returns 401 without X-Club-Id header', () => {
      const result = extractAuth(makeEvent({}));
      expect(isAuthError(result)).toBe(true);
      const resp = result as LambdaResult;
      expect(resp.statusCode).toBe(401);
      const body = JSON.parse(resp.body);
      expect(body.errors[0].code).toBe('UNAUTHORIZED');
    });
  });

  describe('production mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('returns 401 without Authorization header', () => {
      const result = extractAuth(makeEvent({ 'x-club-id': 'club-123' }));
      expect(isAuthError(result)).toBe(true);
      expect((result as LambdaResult).statusCode).toBe(401);
    });

    it('returns 401 with non-Bearer authorization', () => {
      const result = extractAuth(makeEvent({
        'x-club-id': 'club-123',
        'authorization': 'Basic abc123',
      }));
      expect(isAuthError(result)).toBe(true);
      expect((result as LambdaResult).statusCode).toBe(401);
    });

    it('returns 501 for unimplemented JWT verification', () => {
      const result = extractAuth(makeEvent({
        'x-club-id': 'club-123',
        'authorization': 'Bearer some-jwt-token',
      }));
      expect(isAuthError(result)).toBe(true);
      expect((result as LambdaResult).statusCode).toBe(501);
    });
  });
});

describe('isAuthError', () => {
  it('returns true for LambdaResult (has statusCode)', () => {
    const result: LambdaResult = { statusCode: 401, headers: {}, body: '{}' };
    expect(isAuthError(result)).toBe(true);
  });

  it('returns false for AuthContext (no statusCode)', () => {
    const auth: AuthContext = { clubId: 'c1', userId: 'u1', role: 'admin' };
    expect(isAuthError(auth)).toBe(false);
  });
});

describe('requireRole', () => {
  const adminAuth: AuthContext = { clubId: 'c1', userId: 'u1', role: 'admin' };
  const viewerAuth: AuthContext = { clubId: 'c1', userId: 'u1', role: 'viewer' };

  it('returns null when role matches', () => {
    expect(requireRole(adminAuth, 'admin')).toBeNull();
  });

  it('returns null when role is in allowed list', () => {
    expect(requireRole(adminAuth, 'admin', 'editor')).toBeNull();
  });

  it('returns 403 when role does not match', () => {
    const result = requireRole(viewerAuth, 'admin');
    expect(result).not.toBeNull();
    expect(result!.statusCode).toBe(403);
    const body = JSON.parse(result!.body);
    expect(body.errors[0].code).toBe('FORBIDDEN');
  });

  it('returns 403 when role is not in allowed list', () => {
    const result = requireRole(viewerAuth, 'admin', 'editor');
    expect(result).not.toBeNull();
    expect(result!.statusCode).toBe(403);
  });
});
