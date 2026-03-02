import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://clubiq:clubiq_dev@localhost:5432/clubiq';
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('Connected to database');

    // Ensure schema_migrations exists (created by 001, but we need it before running anything)
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Get already-applied versions
    const { rows: applied } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const appliedVersions = new Set(applied.map((r: { version: number }) => r.version));

    // Find all .sql files
    const files = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let ran = 0;

    for (const file of files) {
      const version = parseInt(file.split('_')[0], 10);
      if (isNaN(version)) continue;
      if (appliedVersions.has(version)) {
        console.log(`  skip ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(__dirname, file), 'utf-8');
      console.log(`  applying ${file}...`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [version, file]
        );
        await client.query('COMMIT');
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err}`);
      }
    }

    console.log(ran > 0 ? `\nDone — ${ran} migration(s) applied.` : '\nAll migrations already applied.');
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
