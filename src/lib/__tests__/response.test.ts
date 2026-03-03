import { describe, it, expect, beforeEach } from 'vitest';
import { ok, created, err, notFound, badRequest, setRequestOrigin } from '../response.js';

function parseBody(result: { body: string }) {
  return JSON.parse(result.body);
}

describe('response helpers', () => {
  beforeEach(() => {
    setRequestOrigin(undefined);
  });

  describe('ok()', () => {
    it('returns 200 with envelope format', () => {
      const result = ok({ name: 'test' });
      expect(result.statusCode).toBe(200);
      const body = parseBody(result);
      expect(body.data).toEqual({ name: 'test' });
      expect(body.errors).toEqual([]);
      expect(body.meta.request_id).toBeDefined();
      expect(body.meta.timestamp).toBeDefined();
    });

    it('converts camelCase keys to snake_case in data', () => {
      const result = ok({ userName: 'alice', ageGroup: 'U14' });
      const body = parseBody(result);
      expect(body.data).toHaveProperty('user_name', 'alice');
      expect(body.data).toHaveProperty('age_group', 'U14');
    });

    it('handles nested objects', () => {
      const result = ok({ outer: { innerValue: 1 } });
      const body = parseBody(result);
      expect(body.data.outer.inner_value).toBe(1);
    });

    it('handles arrays', () => {
      const result = ok([{ teamName: 'A' }, { teamName: 'B' }]);
      const body = parseBody(result);
      expect(body.data[0]).toHaveProperty('team_name', 'A');
      expect(body.data[1]).toHaveProperty('team_name', 'B');
    });

    it('includes pagination when provided', () => {
      const result = ok([], { page: 1, per_page: 20, total: 50 });
      const body = parseBody(result);
      expect(body.meta.pagination).toEqual({ page: 1, per_page: 20, total: 50 });
    });

    it('omits pagination when not provided', () => {
      const result = ok([]);
      const body = parseBody(result);
      expect(body.meta.pagination).toBeUndefined();
    });
  });

  describe('created()', () => {
    it('returns 201 with envelope format', () => {
      const result = created({ id: '123' });
      expect(result.statusCode).toBe(201);
      const body = parseBody(result);
      expect(body.data).toEqual({ id: '123' });
      expect(body.errors).toEqual([]);
    });
  });

  describe('err()', () => {
    it('returns correct status code and error object', () => {
      const result = err(422, 'VALIDATION_ERROR', 'Invalid input');
      expect(result.statusCode).toBe(422);
      const body = parseBody(result);
      expect(body.data).toBeNull();
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(body.errors[0].message).toBe('Invalid input');
    });

    it('includes field when provided', () => {
      const result = err(400, 'BAD_REQUEST', 'Invalid email', 'email');
      const body = parseBody(result);
      expect(body.errors[0].field).toBe('email');
    });

    it('omits field when not provided', () => {
      const result = err(500, 'INTERNAL', 'Something broke');
      const body = parseBody(result);
      expect(body.errors[0].field).toBeUndefined();
    });
  });

  describe('notFound()', () => {
    it('returns 404 with NOT_FOUND code', () => {
      const result = notFound();
      expect(result.statusCode).toBe(404);
      const body = parseBody(result);
      expect(body.errors[0].code).toBe('NOT_FOUND');
    });

    it('accepts custom message', () => {
      const result = notFound('Player not found');
      const body = parseBody(result);
      expect(body.errors[0].message).toBe('Player not found');
    });
  });

  describe('badRequest()', () => {
    it('returns 400 with BAD_REQUEST code', () => {
      const result = badRequest('Missing name');
      expect(result.statusCode).toBe(400);
      const body = parseBody(result);
      expect(body.errors[0].code).toBe('BAD_REQUEST');
      expect(body.errors[0].message).toBe('Missing name');
    });

    it('includes field when provided', () => {
      const result = badRequest('Too short', 'name');
      const body = parseBody(result);
      expect(body.errors[0].field).toBe('name');
    });
  });

  describe('CORS headers', () => {
    it('defaults to localhost:5173', () => {
      setRequestOrigin(undefined);
      const result = ok({});
      expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    });

    it('allows whitelisted origins', () => {
      setRequestOrigin('http://localhost:3000');
      const result = ok({});
      expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    });

    it('allows any localhost port in development', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      setRequestOrigin('http://localhost:9999');
      const result = ok({});
      expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:9999');
      process.env.NODE_ENV = original;
    });

    it('rejects unknown origins (falls back to default)', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      setRequestOrigin('https://evil.com');
      const result = ok({});
      expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
      process.env.NODE_ENV = original;
    });

    it('includes Vary: Origin header', () => {
      const result = ok({});
      expect(result.headers['Vary']).toBe('Origin');
    });
  });
});
