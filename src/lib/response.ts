import crypto from 'node:crypto';
import type { ApiError, ApiResponse, PaginationMeta, LambdaResult } from '../types.js';

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://app.clubiq.com',
];

function getCorsOrigin(origin?: string): string {
  if (!origin) return ALLOWED_ORIGINS[0];
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // In development, allow any localhost port
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}

let _requestOrigin: string | undefined;
export function setRequestOrigin(origin?: string) { _requestOrigin = origin; }

function corsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': getCorsOrigin(_requestOrigin),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Club-Id',
    'Vary': 'Origin',
  };
}

function buildMeta(pagination?: PaginationMeta) {
  return {
    request_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...(pagination ? { pagination } : {}),
  };
}

function toSnakeCase(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function convertKeysToSnakeCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(convertKeysToSnakeCase);
  if (typeof obj === 'object' && obj instanceof Date) return obj.toISOString();
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[toSnakeCase(key)] = convertKeysToSnakeCase(value);
    }
    return result;
  }
  return obj;
}

function respond(statusCode: number, body: ApiResponse): LambdaResult {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

export function ok<T>(data: T, pagination?: PaginationMeta): LambdaResult {
  return respond(200, {
    data: convertKeysToSnakeCase(data) as T,
    meta: buildMeta(pagination),
    errors: [],
  });
}

export function created<T>(data: T): LambdaResult {
  return respond(201, {
    data: convertKeysToSnakeCase(data) as T,
    meta: buildMeta(),
    errors: [],
  });
}

export function err(statusCode: number, code: string, message: string, field?: string): LambdaResult {
  const error: ApiError = { code, message };
  if (field) error.field = field;
  return respond(statusCode, {
    data: null,
    meta: buildMeta(),
    errors: [error],
  });
}

export function notFound(message = 'Resource not found'): LambdaResult {
  return err(404, 'NOT_FOUND', message);
}

export function badRequest(message: string, field?: string): LambdaResult {
  return err(400, 'BAD_REQUEST', message, field);
}
