import pg from 'pg';

/**
 * Set the RLS tenant context on a database client.
 * Must be called before any tenant-scoped queries.
 */
export async function setTenantContext(client: pg.PoolClient, clubId: string): Promise<void> {
  await client.query("SELECT set_config('app.current_club_id', $1, true)", [clubId]);
}
