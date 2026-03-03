/**
 * Pure CSV parsing — no database dependencies.
 * Handles BOM stripping, header normalization, and COPPA column filtering.
 */

// COPPA: Only retain recognized columns, strip all others to avoid storing unnecessary PII
const ALLOWED_COLUMNS = new Set([
  'player_id', 'first_name', 'last_name', 'birth_year', 'gender',
  'team', 'level', 'status', 'season', 'amount', 'payment_date',
  'coach_name', 'tuition_amount',
]);

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[]; strippedColumns: string[] } {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0);

  if (lines.length === 0) return { headers: [], rows: [], strippedColumns: [] };

  const allHeaders = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const strippedColumns = allHeaders.filter(h => !ALLOWED_COLUMNS.has(h));
  const headers = allHeaders.filter(h => ALLOWED_COLUMNS.has(h));
  const headerIndices = headers.map(h => allHeaders.indexOf(h));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[headerIndices[idx]] ?? '';
    });
    rows.push(row);
  }

  return { headers, rows, strippedColumns };
}
