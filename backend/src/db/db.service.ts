import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { TenantContext, TenantState } from './tenant-context';

export const PG_POOL = Symbol('PG_POOL');

export type TenantQuery = <T extends QueryResultRow = any>(sql: string, params?: unknown[]) => Promise<T[]>;

/**
 * The only way application code talks to Postgres.
 *
 * `tenant()` is the unit of work for tenant-owned tables: one pooled client, one
 * short transaction, `app.workspace_id` set with `set_config(..., true)` so it is
 * scoped to exactly that transaction and can never bleed into the next request
 * that borrows the connection. RLS policies read it; if the context is missing,
 * this throws rather than running the query unscoped (fail closed).
 *
 * Rule: never hold a tenant transaction across an LLM or embedding call — a slow
 * provider would pin pool connections and starve every other tenant.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly ctx: TenantContext,
  ) {}

  async tenant<T>(fn: (query: TenantQuery) => Promise<T>): Promise<T> {
    const workspaceId = this.ctx.requireWorkspaceId();
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query(`select set_config('app.workspace_id', $1, true)`, [workspaceId]);
      const result = await fn(bind(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      throw err;
    } finally {
      client.release(broken);
    }
  }

  /** Single tenant-scoped statement. */
  query<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.tenant((q) => q<T>(sql, params));
  }

  /** Non-tenant tables (users, refresh_tokens) and SECURITY DEFINER lookups only. */
  async global<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.pool.query<T>(sql, params);
    return rows;
  }

  /** Enter a workspace resolved outside the JWT path (widget key, queue job, MCP argument). */
  withWorkspace<T>(workspaceId: string, fn: () => Promise<T>, extra: Omit<TenantState, 'workspaceId'> = {}): Promise<T> {
    return this.ctx.run({ ...this.ctx.get(), ...extra, workspaceId }, fn);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

function bind(client: PoolClient): TenantQuery {
  return async (sql, params = []) => (await client.query(sql, params)).rows;
}

/** pgvector text literal: '[0.1,0.2,...]'. */
export const toVector = (values: number[]) => `[${values.join(',')}]`;
