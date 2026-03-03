import { z } from 'zod';

const genderNormalize: Record<string, string> = {
  m: 'M', f: 'F', male: 'M', female: 'F', boy: 'M', girl: 'F',
};

const levelNormalize: Record<string, string> = {
  recreational: 'rec', rec: 'rec',
  competitive: 'select', select: 'select',
  premier: 'premier', elite: 'elite',
};

const paymentStatusNormalize: Record<string, string> = {
  paid: 'paid', pending: 'pending', refunded: 'refunded', failed: 'failed',
  late: 'late', scholarship: 'scholarship',
};

const rosterStatusNormalize: Record<string, string> = {
  active: 'active', inactive: 'inactive', waitlisted: 'waitlisted',
};

function normalizeGender(val: string): string | undefined {
  return genderNormalize[val.toLowerCase().trim()];
}

function normalizeLevel(val: string): string | undefined {
  return levelNormalize[val.toLowerCase().trim()];
}

function parseDate(val: string): string | null {
  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : val;
  }
  // US: MM/DD/YYYY
  const match = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, mm, dd, yyyy] = match;
    const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : iso;
  }
  return null;
}

// Schemas for validated/normalized rows
export const rosterRowSchema = z.object({
  player_id: z.string().optional(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  birth_year: z.number().int().min(2000).max(2025),
  gender: z.string(),
  team: z.string().min(1),
  level: z.string(),
  status: z.string().default('active'),
});

export const paymentRowSchema = z.object({
  player_id: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  birth_year: z.number().int().min(2000).max(2025).optional(),
  season: z.string().min(1),
  amount: z.number().positive(),
  payment_date: z.string(),
  status: z.string().default('paid'),
});

export type RosterRow = z.infer<typeof rosterRowSchema>;
export type PaymentRow = z.infer<typeof paymentRowSchema>;

export interface RowError {
  row_number: number;
  column: string;
  value: string;
  message: string;
}

export interface RowWarning {
  row_number: number;
  type: string;
  message: string;
  matched_player_id?: string;
}

// Required columns per file type
export const REQUIRED_COLUMNS: Record<string, string[]> = {
  roster: ['first_name', 'last_name', 'birth_year', 'gender', 'team', 'level'],
  payment: ['season', 'amount', 'payment_date'],
  historical_roster: ['first_name', 'last_name', 'birth_year', 'gender', 'team', 'level', 'season'],
};

export function validateRosterRow(raw: Record<string, string>, rowNum: number): { row?: RosterRow; errors: RowError[] } {
  const errors: RowError[] = [];

  // Required fields
  for (const col of ['first_name', 'last_name', 'team']) {
    if (!raw[col]?.trim()) {
      errors.push({ row_number: rowNum, column: col, value: raw[col] ?? '', message: `Row ${rowNum}: ${col} is required` });
    }
  }

  // birth_year
  const by = parseInt(raw.birth_year, 10);
  if (isNaN(by) || by < 2000 || by > 2025) {
    errors.push({ row_number: rowNum, column: 'birth_year', value: raw.birth_year ?? '', message: `Row ${rowNum}: birth_year must be a 4-digit year between 2000 and 2025` });
  }

  // gender
  const gender = raw.gender ? normalizeGender(raw.gender) : undefined;
  if (!gender) {
    errors.push({ row_number: rowNum, column: 'gender', value: raw.gender ?? '', message: `Row ${rowNum}: gender must be M, F, Male, Female, Boy, or Girl` });
  }

  // level
  const level = raw.level ? normalizeLevel(raw.level) : undefined;
  if (!level) {
    errors.push({ row_number: rowNum, column: 'level', value: raw.level ?? '', message: `Row ${rowNum}: level must be recreational, competitive, premier, or elite` });
  }

  // status
  const status = raw.status ? rosterStatusNormalize[raw.status.toLowerCase().trim()] : 'active';
  if (raw.status && !status) {
    errors.push({ row_number: rowNum, column: 'status', value: raw.status, message: `Row ${rowNum}: status must be one of: active, inactive, waitlisted` });
  }

  if (errors.length > 0) return { errors };

  return {
    row: {
      player_id: raw.player_id?.trim() || undefined,
      first_name: raw.first_name.trim(),
      last_name: raw.last_name.trim(),
      birth_year: by,
      gender: gender!,
      team: raw.team.trim(),
      level: level!,
      status: status ?? 'active',
    },
    errors: [],
  };
}

export function validatePaymentRow(raw: Record<string, string>, rowNum: number): { row?: PaymentRow; errors: RowError[] } {
  const errors: RowError[] = [];

  // season
  if (!raw.season?.trim()) {
    errors.push({ row_number: rowNum, column: 'season', value: raw.season ?? '', message: `Row ${rowNum}: season is required` });
  }

  // amount
  const amount = parseFloat(raw.amount);
  if (isNaN(amount) || amount <= 0) {
    errors.push({ row_number: rowNum, column: 'amount', value: raw.amount ?? '', message: `Row ${rowNum}: amount must be a positive number` });
  }

  // payment_date
  const paymentDate = raw.payment_date ? parseDate(raw.payment_date.trim()) : null;
  if (!paymentDate) {
    errors.push({ row_number: rowNum, column: 'payment_date', value: raw.payment_date ?? '', message: `Row ${rowNum}: payment_date must be a valid date (YYYY-MM-DD or MM/DD/YYYY)` });
  }

  // Must have player_id OR (first_name + last_name + birth_year)
  const hasId = !!raw.player_id?.trim();
  const hasName = !!raw.first_name?.trim() && !!raw.last_name?.trim();
  if (!hasId && !hasName) {
    errors.push({ row_number: rowNum, column: 'player_id', value: '', message: `Row ${rowNum}: either player_id or first_name+last_name+birth_year is required` });
  }

  // status
  const status = raw.status ? paymentStatusNormalize[raw.status.toLowerCase().trim()] : 'paid';
  if (raw.status && !status) {
    errors.push({ row_number: rowNum, column: 'status', value: raw.status, message: `Row ${rowNum}: status must be one of: paid, pending, refunded, failed` });
  }

  if (errors.length > 0) return { errors };

  const by = raw.birth_year ? parseInt(raw.birth_year, 10) : undefined;

  return {
    row: {
      player_id: raw.player_id?.trim() || undefined,
      first_name: raw.first_name?.trim() || undefined,
      last_name: raw.last_name?.trim() || undefined,
      birth_year: by,
      season: raw.season.trim(),
      amount: Math.round(amount * 100), // Store as cents
      payment_date: paymentDate!,
      status: status ?? 'paid',
    },
    errors: [],
  };
}
