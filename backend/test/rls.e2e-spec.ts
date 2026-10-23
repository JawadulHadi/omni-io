/**
 * Proves tenant isolation is enforced by Postgres itself, through the same
 * DbService the app uses, connected as the same `omniio_app` role.
 *
 *   npm run migrate && npm run test:e2e
 *
 * Uses TEST_DATABASE_URL (falls back to DATABASE_URL). Skipped if neither is set.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { Pool } from 'pg';
import { DbService, toVector } from '../src/db/db.service';
import { TenantContext } from '../src/db/tenant-context';
import { hashEmbed } from '../src/lib/ai/fake.provider';

// Jest sandboxes process.env, so read .env directly rather than via process.loadEnvFile.
const envFile = join(__dirname, '..', '.env');
const dotenv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? dotenv.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('Row-level security (real Postgres)', () => {
  const pool = new Pool({ connectionString: url, max: 2 }); // tiny pool: forces connection reuse between transactions
  const tenant = new TenantContext();
  const db = new DbService(pool, tenant);
  const A = randomUUID();
  const B = randomUUID();
  const docA = randomUUID();
  const docB = randomUUID();
  const inA = <T>(fn: () => Promise<T>) => db.withWorkspace(A, fn);
  const inB = <T>(fn: () => Promise<T>) => db.withWorkspace(B, fn);

  beforeAll(async () => {
    for (const [ws, doc, title] of [
      [A, docA, 'Alpha handbook'],
      [B, docB, 'Bravo secrets'],
    ] as const) {
      await db.withWorkspace(ws, () =>
        db.tenant(async (q) => {
          await q('insert into workspaces (id, name) values ($1, $2)', [ws, `rls-test ${ws.slice(0, 8)}`]);
          await q(`insert into documents (id, workspace_id, source_type, title, status, visibility) values ($1, $2, 'paste', $3, 'ready', 'public')`, [
            doc,
            ws,
            title,
          ]);
          await q('insert into chunks (id, workspace_id, document_id, chunk_index, content, embedding) values ($1, $2, $3, 0, $4, $5::vector)', [
            `${doc}:0`,
            ws,
            doc,
            `${title} refund policy`,
            toVector(hashEmbed(`${title} refund policy`)),
          ]);
        }),
      );
    }
  });

  afterAll(async () => {
    for (const ws of [A, B]) await db.withWorkspace(ws, () => db.query('delete from workspaces where id = $1', [ws]));
    await pool.end();
  });

  it('connects as a role that cannot bypass RLS', async () => {
    const [role] = await db.global('select rolsuper, rolbypassrls from pg_roles where rolname = current_user');
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('returns only the current tenant rows even with NO where clause', async () => {
    const titles = await inA(() => db.query<{ title: string }>('select title from documents'));
    expect(titles.map((t) => t.title)).toContain('Alpha handbook');
    expect(titles.map((t) => t.title)).not.toContain('Bravo secrets');
  });

  it('returns nothing outside a tenant transaction — including on a connection that just ran SET LOCAL', async () => {
    await inA(() => db.query('select 1')); // leaves app.workspace_id = '' on that pooled connection
    const rows = await db.global('select id from documents where id = any($1)', [[docA, docB]]);
    expect(rows).toEqual([]);
  });

  it("refuses to write a row into another tenant's workspace", async () => {
    await expect(
      inA(() =>
        db.query(`insert into documents (workspace_id, source_type, title) values ($1, 'paste', 'smuggled')`, [B]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("can't update or delete another tenant's rows", async () => {
    const updated = await inA(() => db.query('update documents set title = $2 where id = $1 returning id', [docB, 'pwned']));
    const deleted = await inA(() => db.query('delete from documents where id = $1 returning id', [docB]));
    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
    const [still] = await inB(() => db.query('select title from documents where id = $1', [docB]));
    expect(still.title).toBe('Bravo secrets');
  });

  it("vector search can't return another tenant's chunks even when asked for them", async () => {
    const hits = await inA(() =>
      db.query('select id from match_chunks($1, $2::vector, 10, false)', [B, toVector(hashEmbed('Bravo secrets refund policy'))]),
    );
    expect(hits).toEqual([]);
  });

  it('resolves a widget key before any tenant context exists (SECURITY DEFINER)', async () => {
    const [{ widget_key: key }] = await inA(() => db.query('select widget_key from workspaces where id = $1', [A]));
    const [row] = await db.global('select resolve_widget_key($1) as id', [key]);
    expect(row.id).toBe(A);
  });

  it('never lets the app role read password hashes directly', async () => {
    await expect(db.global('select password_hash from users limit 1')).rejects.toThrow(/permission denied/);
  });

  it('refuses to run a tenant query with no workspace in context (fail closed)', async () => {
    await expect(db.query('select 1')).rejects.toThrow(/No workspace in tenant context/);
  });
});
