import type { ApiResponse, LambdaResult } from '../types.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Club-Id',
};

export function ok<T>(data: T, meta?: ApiResponse['meta']): LambdaResult {
  const body: ApiResponse<T> = { success: true, data };
  if (meta) body.meta = meta;
  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

export function created<T>(data: T): LambdaResult {
  return {
    statusCode: 201,
    headers: JSON_HEADERS,
    body: JSON.stringify({ success: true, data }),
  };
}

export function err(statusCode: number, code: string, message: string): LambdaResult {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify({ success: false, error: { code, message } }),
  };
}

export function notFound(message = 'Resource not found'): LambdaResult {
  return err(404, 'NOT_FOUND', message);
}

export function badRequest(message: string): LambdaResult {
  return err(400, 'BAD_REQUEST', message);
}
