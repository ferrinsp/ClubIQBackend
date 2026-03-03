/**
 * Generic multi-row VALUES clause builder for batch inserts.
 */

export const BATCH_SIZE = 500;

/**
 * Build a multi-row VALUES clause and flat params array.
 * tuples: array of row arrays, e.g. [[a,b,c], [d,e,f]]
 * offset: starting $N index (default 1)
 */
export function buildBatchValues(tuples: unknown[][], offset = 1): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const groups: string[] = [];
  let idx = offset;
  for (const tuple of tuples) {
    const placeholders: string[] = [];
    for (const val of tuple) {
      placeholders.push(`$${idx++}`);
      params.push(val);
    }
    groups.push(`(${placeholders.join(', ')})`);
  }
  return { clause: groups.join(', '), params };
}
