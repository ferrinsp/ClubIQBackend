import pg from 'pg';
import { env } from './env.js';

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
  clubId?: string,
): Promise<pg.QueryResult<T>> {
  const client = await pool.connect();
  try {
    if (clubId) {
      await client.query("SELECT set_config('app.current_club_id', $1, true)", [clubId]);
    }
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export { pool };
