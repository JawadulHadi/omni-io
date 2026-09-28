# Multi-tenancy and row-level security

Tenant isolation is enforced by **Postgres**, not by remembering to write `WHERE workspace_id = $1`. The design goal is that a bug in a service method can't leak another tenant's rows, because the database won't return them.

## The three ways RLS silently doesn't work — and how each is closed

| Pitfall | What goes wrong | How Omni.io closes it |
| --- | --- | --- |
| Connecting as a superuser or the table owner | Superusers always bypass RLS; owners bypass it unless `FORCE ROW LEVEL SECURITY` is set. Every policy becomes decorative | The app connects as `omniio_app`: `NOSUPERUSER NOBYPASSRLS`, not the owner. Migrations use a separate owner role |
| Setting the tenant outside the query's transaction | `set_config(…, true)` run as its own statement is discarded immediately, and the next query may land on a different pooled connection | `DbService.tenant()` runs `BEGIN` → `set_config` → your queries → `COMMIT` on **one** checked-out client |
| The empty-string setting | Once a pooled connection has run a transaction-local set, the setting reads back as `''` (not `NULL`) in later transactions, and `''::uuid` throws | Every policy uses `nullif(current_setting('app.workspace_id', true), '')::uuid` |

The third pitfall is easy to reproduce:

```sql
begin; select set_config('app.workspace_id', gen_random_uuid()::text, true); commit;
select current_setting('app.workspace_id', true);        -- ''  (not NULL)
select current_setting('app.workspace_id', true)::uuid;  -- ERROR: invalid input syntax for type uuid: ""
```

## Roles

| Role | Used by | Privileges |
| --- | --- | --- |
| `omniio` (owner) | `npm run migrate` only | Owns every table and function |
| `omniio_app` | API and worker | DML on tenant tables. **Column-level** grants on `users`, so it can't `SELECT password_hash`. `EXECUTE` on four definer functions. No BYPASSRLS |

RLS is **enabled, not forced**. That lets the owner-owned `SECURITY DEFINER` functions below see across tenants, and nothing else can.

## The unit of work

[`backend/src/db/db.service.ts`](../backend/src/db/db.service.ts):

```ts
async tenant<T>(fn: (query: TenantQuery) => Promise<T>): Promise<T> {
  const workspaceId = this.ctx.requireWorkspaceId();   // throws if absent: fail closed
  const client = await this.pool.connect();
  await client.query('BEGIN');
  await client.query(`select set_config('app.workspace_id', $1, true)`, [workspaceId]);
  const result = await fn(bind(client));
  await client.query('COMMIT');
  // (ROLLBACK and release handling omitted here)
}
```

- The workspace comes from a request-scoped `TenantContext` (AsyncLocalStorage), which `AuthGuard` fills from the verified JWT. Services never pass tenant ids around, so they can't pass the wrong one.
- The widget (by key), the worker (from the job) and MCP (a checked argument) enter a workspace explicitly with `db.withWorkspace(id, fn)`.
- **A tenant transaction is never held across a model or embedding call.** A slow provider would otherwise pin pool connections and starve every other tenant.

## Policies

```sql
create policy tenant_isolation on documents
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
```

`WITH CHECK` stops an insert or update from writing a row into another workspace, not just reading one.

## Pre-tenant lookups

Some lookups have to happen before a workspace is known. They go through `SECURITY DEFINER` functions with a pinned `search_path` and `EXECUTE` revoked from `PUBLIC`:

| Function | Used for |
| --- | --- |
| `auth_find_user(email)` | Login: returns one user's id and password hash |
| `user_workspaces(user_id)` | Choosing a workspace at login; `myWorkspaces`; MCP `list_workspaces` |
| `workspace_role(workspace_id, user_id)` | `RolesGuard`'s live role check on every guarded request |
| `resolve_widget_key(key)` | Widget key → workspace id |

## Vector search

`match_chunks(workspace_id, embedding, top_k, public_only)` filters by workspace inside the SQL, on top of RLS, so even a wrong argument returns nothing. It uses HNSW with `hnsw.iterative_scan = relaxed_order` (pgvector ≥ 0.8), so the tenant filter can't starve the top-k.

## Proof

[`backend/test/rls.e2e-spec.ts`](../backend/test/rls.e2e-spec.ts) runs against real Postgres, as `omniio_app`, through the real `DbService`. It checks that:
- the role cannot bypass RLS
- a query with **no WHERE clause** returns only the current tenant's rows
- nothing is returned outside a tenant transaction, including on a connection that just ran `SET LOCAL`
- cross-tenant inserts are rejected, and cross-tenant updates and deletes affect 0 rows
- `match_chunks` returns nothing when pointed at another tenant
- the widget key resolves without a tenant context
- `password_hash` is unreadable
- a tenant query with no context throws

## Checklist: adding a tenant-owned table

1. Add `workspace_id uuid not null references workspaces(id) on delete cascade`.
2. `alter table … enable row level security;`
3. Create `tenant_isolation` with **both** `USING` and `WITH CHECK`, using the `nullif(...)` form.
4. `grant select, insert, update, delete on … to omniio_app;` Grants are explicit per migration — there are no default privileges.
5. Index `(workspace_id, …)` for the access pattern.
6. Add a case to `rls.e2e-spec.ts`.
