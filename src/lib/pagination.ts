import type { LambdaEvent, PaginationMeta } from '../types.js';

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

export interface PaginationParams {
  page: number;
  perPage: number;
  offset: number;
}

export function parsePagination(event: LambdaEvent): PaginationParams {
  const qs = event.queryStringParameters ?? {};
  const page = Math.max(1, parseInt(qs.page ?? '1', 10) || 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, parseInt(qs.per_page ?? String(DEFAULT_PER_PAGE), 10) || DEFAULT_PER_PAGE));
  return { page, perPage, offset: (page - 1) * perPage };
}

export function buildPaginationMeta(page: number, perPage: number, total: number): PaginationMeta {
  return { page, per_page: perPage, total };
}
