/**
 * Minimal forward-only migration runner: applies migrations/*.sql in filename
 * order, one transaction per file, recorded in schema_migrations.
 *
 * Runs as DATABASE_MIGRATOR_URL (the schema owner), never as the app role —
 * the app role must not be able to alter tables or policies.
 *
 * Lives in src/ so the build compiles it: `npm run migrate` in development,
 * `node dist/migrate.js` in a production image. Either way, migrations/ and
 * .env are one directory up.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const LOCK_ID = 727274;

async function main() {
  try {
    process.loadEnvFile(join(__dirname, '..', '.env'));
  } catch {
    // No .env file: rely on the process environment.
  }
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error('DATABASE_MIGRATOR_URL is not set (migrations run as the schema owner, not the app role)');

  const dir = join(__dirname, '..', 'migrations');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      'create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())',
    );
    const { rows } = await client.query<{ filename: string }>('select filename from schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    const pending = readdirSync(dir)
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .sort()
      .filter((f) => !applied.has(f));

    if (pending.length === 0) console.log('No pending migrations.');
    for (const file of pending) {
      const sql = readFileSync(join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (filename) values ($1)', [file]);
        await client.query('commit');
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`${file} failed: ${(err as Error).message}`);
      }
    }
    await enableAppLogin(client);
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}

/**
 * Managed Postgres (Neon, Supabase, ...) has no init script to give omniio_app a
 * login — migration 0003 creates it NOLOGIN. With APP_DB_PASSWORD set, set it here,
 * on every run, so rotating the password is just changing the variable.
 */
async function enableAppLogin(client: Client) {
  const password = process.env.APP_DB_PASSWORD;
  if (!password) return;
  const { rows } = await client.query(`select format('alter role omniio_app with login password %L', $1::text) as sql`, [password]);
  await client.query(rows[0].sql);
  console.log('omniio_app can log in');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
