import { describe, it, expect } from 'vitest';
import { validateRosterRow, validatePaymentRow, REQUIRED_COLUMNS } from '../csv-schemas.js';

describe('REQUIRED_COLUMNS', () => {
  it('defines roster columns', () => {
    expect(REQUIRED_COLUMNS.roster).toEqual(
      expect.arrayContaining(['first_name', 'last_name', 'birth_year', 'gender', 'team', 'level'])
    );
  });

  it('defines payment columns', () => {
    expect(REQUIRED_COLUMNS.payment).toEqual(
      expect.arrayContaining(['season', 'amount', 'payment_date'])
    );
  });

  it('defines historical_roster columns (includes season)', () => {
    expect(REQUIRED_COLUMNS.historical_roster).toContain('season');
    expect(REQUIRED_COLUMNS.historical_roster).toContain('first_name');
  });
});

describe('validateRosterRow', () => {
  const validRaw: Record<string, string> = {
    first_name: 'James',
    last_name: 'Smith',
    birth_year: '2013',
    gender: 'M',
    team: 'U12 Blue',
    level: 'select',
    status: 'active',
  };

  it('returns a valid RosterRow for correct input', () => {
    const { row, errors } = validateRosterRow(validRaw, 2);
    expect(errors).toHaveLength(0);
    expect(row).toBeDefined();
    expect(row!.first_name).toBe('James');
    expect(row!.last_name).toBe('Smith');
    expect(row!.birth_year).toBe(2013);
    expect(row!.gender).toBe('M');
    expect(row!.team).toBe('U12 Blue');
    expect(row!.level).toBe('select');
    expect(row!.status).toBe('active');
  });

  it('normalizes gender variants', () => {
    const { row } = validateRosterRow({ ...validRaw, gender: 'female' }, 2);
    expect(row!.gender).toBe('F');

    const { row: row2 } = validateRosterRow({ ...validRaw, gender: 'Boy' }, 2);
    expect(row2!.gender).toBe('M');
  });

  it('normalizes level variants', () => {
    const { row } = validateRosterRow({ ...validRaw, level: 'recreational' }, 2);
    expect(row!.level).toBe('rec');

    const { row: row2 } = validateRosterRow({ ...validRaw, level: 'competitive' }, 2);
    expect(row2!.level).toBe('select');
  });

  it('defaults status to active when not provided', () => {
    const raw = { ...validRaw };
    delete (raw as any).status;
    const { row } = validateRosterRow(raw, 2);
    expect(row!.status).toBe('active');
  });

  it('rejects missing first_name', () => {
    const { errors } = validateRosterRow({ ...validRaw, first_name: '' }, 2);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.column === 'first_name')).toBe(true);
  });

  it('rejects missing last_name', () => {
    const { errors } = validateRosterRow({ ...validRaw, last_name: '  ' }, 2);
    expect(errors.some(e => e.column === 'last_name')).toBe(true);
  });

  it('rejects invalid birth_year', () => {
    const { errors } = validateRosterRow({ ...validRaw, birth_year: '1990' }, 2);
    expect(errors.some(e => e.column === 'birth_year')).toBe(true);
  });

  it('rejects non-numeric birth_year', () => {
    const { errors } = validateRosterRow({ ...validRaw, birth_year: 'abc' }, 2);
    expect(errors.some(e => e.column === 'birth_year')).toBe(true);
  });

  it('rejects invalid gender', () => {
    const { errors } = validateRosterRow({ ...validRaw, gender: 'X' }, 2);
    expect(errors.some(e => e.column === 'gender')).toBe(true);
  });

  it('rejects invalid level', () => {
    const { errors } = validateRosterRow({ ...validRaw, level: 'professional' }, 2);
    expect(errors.some(e => e.column === 'level')).toBe(true);
  });

  it('rejects invalid status', () => {
    const { errors } = validateRosterRow({ ...validRaw, status: 'deleted' }, 2);
    expect(errors.some(e => e.column === 'status')).toBe(true);
  });

  it('reports all errors at once', () => {
    const { errors } = validateRosterRow({
      first_name: '',
      last_name: '',
      birth_year: 'x',
      gender: 'Z',
      team: '',
      level: 'nope',
    }, 5);
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });

  it('includes player_id when provided', () => {
    const { row } = validateRosterRow({ ...validRaw, player_id: 'PLR-123' }, 2);
    expect(row!.player_id).toBe('PLR-123');
  });

  it('omits player_id when empty', () => {
    const { row } = validateRosterRow({ ...validRaw, player_id: '' }, 2);
    expect(row!.player_id).toBeUndefined();
  });
});

describe('validatePaymentRow', () => {
  const validRaw: Record<string, string> = {
    player_id: 'PLR-001',
    season: 'Fall 2025',
    amount: '1500',
    payment_date: '2025-08-01',
    status: 'paid',
  };

  it('returns a valid PaymentRow for correct input', () => {
    const { row, errors } = validatePaymentRow(validRaw, 2);
    expect(errors).toHaveLength(0);
    expect(row).toBeDefined();
    expect(row!.player_id).toBe('PLR-001');
    expect(row!.season).toBe('Fall 2025');
    expect(row!.amount).toBe(150000); // stored as cents
    expect(row!.payment_date).toBe('2025-08-01');
    expect(row!.status).toBe('paid');
  });

  it('accepts US date format (MM/DD/YYYY)', () => {
    const { row } = validatePaymentRow({ ...validRaw, payment_date: '8/1/2025' }, 2);
    expect(row!.payment_date).toBe('2025-08-01');
  });

  it('defaults status to paid when not provided', () => {
    const raw = { ...validRaw };
    delete (raw as any).status;
    const { row } = validatePaymentRow(raw, 2);
    expect(row!.status).toBe('paid');
  });

  it('accepts name-based identification (no player_id)', () => {
    const raw: Record<string, string> = {
      first_name: 'James',
      last_name: 'Smith',
      birth_year: '2013',
      season: 'Fall 2025',
      amount: '1000',
      payment_date: '2025-08-01',
    };
    const { row, errors } = validatePaymentRow(raw, 2);
    expect(errors).toHaveLength(0);
    expect(row!.first_name).toBe('James');
    expect(row!.last_name).toBe('Smith');
    expect(row!.birth_year).toBe(2013);
  });

  it('rejects missing season', () => {
    const { errors } = validatePaymentRow({ ...validRaw, season: '' }, 2);
    expect(errors.some(e => e.column === 'season')).toBe(true);
  });

  it('rejects non-positive amount', () => {
    const { errors } = validatePaymentRow({ ...validRaw, amount: '0' }, 2);
    expect(errors.some(e => e.column === 'amount')).toBe(true);
  });

  it('rejects negative amount', () => {
    const { errors } = validatePaymentRow({ ...validRaw, amount: '-50' }, 2);
    expect(errors.some(e => e.column === 'amount')).toBe(true);
  });

  it('rejects invalid date format', () => {
    const { errors } = validatePaymentRow({ ...validRaw, payment_date: 'Aug 1 2025' }, 2);
    expect(errors.some(e => e.column === 'payment_date')).toBe(true);
  });

  it('rejects row with no player_id and no name', () => {
    const { errors } = validatePaymentRow({
      season: 'Fall 2025',
      amount: '1000',
      payment_date: '2025-08-01',
    }, 2);
    expect(errors.some(e => e.column === 'player_id')).toBe(true);
  });

  it('rejects invalid payment status', () => {
    const { errors } = validatePaymentRow({ ...validRaw, status: 'cancelled' }, 2);
    expect(errors.some(e => e.column === 'status')).toBe(true);
  });
});
