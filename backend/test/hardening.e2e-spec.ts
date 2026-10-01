/**
 * Integration tests for migration 0004 against the real Postgres, as omniio_app:
 * invitation links, the exact vector-search fallback and retention.
 *
 * Uses TEST_DATABASE_URL (falls back to DATABASE_URL). Skipped if neither is set.
 * Test users are removed afterwards when DATABASE_MIGRATOR_URL is available
 * (the app role can't delete users).
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { Pool } from 'pg';
import { DbService } from '../src/db/db.service';
import { TenantContext } from '../src/db/tenant-context';

const envFile = join(__dirname, '..', '.env');
const dotenv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? dotenv.DATABASE_URL;
const migratorUrl = process.env.DATABASE_MIGRATOR_URL ?? dotenv.DATABASE_MIGRATOR_URL;
const suite = url ? describe : describe.skip;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

suite('Migration 0004 (real Postgres)', () => {
  const pool = new Pool({ connectionString: url, max: 2 });
  const tenant = new TenantContext();
  const db = new DbService(pool, tenant);
  const A = randomUUID();
  const B = randomUUID();
  const doc = randomUUID();
  const userIds: string[] = [];
  const inA = <T>(fn: () => Promise<T>) => db.withWorkspace(A, fn);
  const inB = <T>(fn: () => Promise<T>) => db.withWorkspace(B, fn);

  const createUser = async () => {
    const [row] = await db.global<{ id: string }>('insert into users (email, display_name) values ($1, $2) returning id', [
      `e2e-${randomUUID()}@test.invalid`,
      'E2E user',
    ]);
    userIds.push(row.id);
    return row.id;
  };
  const invite = (ws: string, token: string, role = 'editor', expires = "now() + interval '7 days'") =>
    db.withWorkspace(ws, () =>
      db.query(`insert into workspace_invitations (workspace_id, token_hash, role, expires_at) values ($1, $2, $3, ${expires}) returning id`, [
        ws,
        sha256(token),
        role,
      ]),
    );

  beforeAll(async () => {
    for (const ws of [A, B]) {
      await db.withWorkspace(ws, () => db.query('insert into workspaces (id, name) values ($1, $2)', [ws, `e2e ${ws.slice(0, 8)}`]));
    }
  });

  afterAll(async () => {
    for (const ws of [A, B]) await db.withWorkspace(ws, () => db.query('delete from workspaces where id = $1', [ws]));
    if (migratorUrl && userIds.length) {
      const owner = new Pool({ connectionString: migratorUrl, max: 1 });
      await owner.query('delete from users where id = any($1)', [userIds]);
      await owner.end();
    }
    await pool.end();
  });

  describe('invitation links', () => {
    it("are invisible to another workspace's tenant context", async () => {
      await invite(A, `isolation-${randomUUID()}`);
      const seenFromB = await inB(() => db.query('select id from workspace_invitations'));
      expect(seenFromB).toEqual([]);
    });

    it('join the workspace with the invited role, and only once', async () => {
      const userId = await createUser();
      const token = `once-${randomUUID()}`;
      await invite(A, token, 'editor');

      const [preview] = await db.global('select workspace_id, role from invitation_preview($1)', [sha256(token)]);
      expect(preview).toEqual({ workspace_id: A, role: 'editor' });

      const [joined] = await db.global('select workspace_id, role from accept_invitation($1, $2)', [sha256(token), userId]);
      expect(joined).toEqual({ workspace_id: A, role: 'editor' });
      const [{ role }] = await db.global('select workspace_role($1, $2) as role', [A, userId]);
      expect(role).toBe('editor');

      const again = await db.global('select * from accept_invitation($1, $2)', [sha256(token), userId]);
      expect(again).toEqual([]);
    });

    it("don't change an existing member's role", async () => {
      const userId = await createUser();
      await inA(() => db.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin')`, [A, userId]));
      const token = `member-${randomUUID()}`;
      await invite(A, token, 'viewer');

      const [joined] = await db.global('select role from accept_invitation($1, $2)', [sha256(token), userId]);
      expect(joined.role).toBe('admin');
    });

    it('are refused once expired', async () => {
      const userId = await createUser();
      const token = `expired-${randomUUID()}`;
      await invite(A, token, 'viewer', "now() - interval '1 minute'");

      expect(await db.global('select * from invitation_preview($1)', [sha256(token)])).toEqual([]);
      expect(await db.global('select * from accept_invitation($1, $2)', [sha256(token), userId])).toEqual([]);
    });
  });

  describe('match_chunks', () => {
    const docB = randomUUID();
    const query = `[${new Array(768).fill(1).join(',')}]`;
    // A big tenant crowds the query's neighbourhood; the small tenant's chunks are all far away.
    const crowd = (q: (sql: string, params?: unknown[]) => Promise<unknown>, ws: string, document: string, count: number, near: boolean) =>
      q(
        `insert into chunks (id, workspace_id, document_id, chunk_index, content, embedding)
         select $3 || ':' || g, $1, $2, g, 'chunk ' || g, v.e
         from generate_series(0, $4 - 1) g
         cross join lateral (
           select array_agg(${near ? '1 + random() * 0.01' : 'case when s % 2 = 0 then 1 else -1 end + random() * 0.5'})::vector(768) as e
           from generate_series(1, 768) s where g >= 0
         ) v`,
        [ws, document, document, count],
      );
    // Planner and HNSW settings that make the approximate scan give up after a few tuples.
    const starve = async (q: (sql: string) => Promise<unknown>) => {
      for (const sql of ['enable_seqscan = off', 'enable_sort = off', 'hnsw.ef_search = 10', 'hnsw.max_scan_tuples = 20', "hnsw.iterative_scan = 'relaxed_order'"]) {
        await q(`set local ${sql}`);
      }
    };

    beforeAll(async () => {
      for (const [ws, document, count, near] of [
        [A, doc, 8, false],
        [B, docB, 300, true],
      ] as const) {
        await db.withWorkspace(ws, () =>
          db.tenant(async (q) => {
            await q(`insert into documents (id, workspace_id, source_type, title, status, visibility) values ($1, $2, 'paste', 'Fallback doc', 'ready', 'public')`, [document, ws]);
            await crowd(q, ws, document, count, near);
          }),
        );
      }
    });

    it("finds a small tenant's top k even when the HNSW scan alone comes back short", async () => {
      const [annOnly, hits] = await inA(() =>
        db.tenant(async (q) => {
          await starve(q);
          const ann = await q(
            `select c.id from chunks c join documents d on d.id = c.document_id
             where c.workspace_id = $1 order by c.embedding <=> $2::vector limit 5`,
            [A, query],
          );
          return [ann, await q<{ similarity: number }>('select similarity from match_chunks($1, $2::vector, 5, false)', [A, query])];
        }),
      );
      expect(annOnly.length).toBeLessThan(5); // the scenario really starves the index scan...
      expect(hits).toHaveLength(5); // ...and the fallback still returns a full result

      const exact = await inA(() =>
        db.query<{ similarity: number }>(
          'select 1 - (embedding <=> $2::vector) as similarity from chunks where workspace_id = $1 order by embedding <=> $2::vector limit 5',
          [A, query],
        ),
      );
      const round = (rows: { similarity: number }[]) => rows.map((r) => Number(r.similarity).toFixed(6));
      expect(round(hits as { similarity: number }[])).toEqual(round(exact));
    });
  });

  describe('run_retention', () => {
    it('removes answers older than the retention period and keeps newer ones', async () => {
      const [old] = await inA(() =>
        db.query(`insert into answers (workspace_id, query, tier, created_at) values ($1, 'ancient', 'faq_floor', '1800-01-01') returning id`, [A]),
      );
      const [recent] = await inA(() => db.query(`insert into answers (workspace_id, query, tier) values ($1, 'recent', 'faq_floor') returning id`, [A]));

      // 100 years: only the 1800 row qualifies, so this is safe against a shared dev database.
      const [purged] = await db.global('select * from run_retention(36500)');
      expect(Number(purged.purged_answers)).toBeGreaterThanOrEqual(1);

      const left = await inA(() => db.query<{ id: string }>('select id from answers where id = any($1)', [[old.id, recent.id]]));
      expect(left.map((r) => r.id)).toEqual([recent.id]);
    });

    it('keeps the answer audit when retention is 0', async () => {
      const [purged] = await db.global('select purged_answers from run_retention(0)');
      expect(Number(purged.purged_answers)).toBe(0);
    });
  });
});
