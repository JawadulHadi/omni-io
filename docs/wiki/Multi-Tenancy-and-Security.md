# Multi-tenancy and security

## Tenant isolation

1. **Request context.** `AuthGuard` puts the workspace into AsyncLocalStorage. With no workspace, database access throws (fail closed).
2. **Unit of work.** One short transaction runs `set_config('app.workspace_id', id, true)`. The setting is transaction-local, so it never leaks to the next pooled request.
3. **Database role.** `omniio_app` is not the owner, not a superuser, and `NOBYPASSRLS`. It cannot read `users.password_hash`.
4. **Policies.** Every tenant table has `USING / WITH CHECK (workspace_id = nullif(current_setting(...), '')::uuid)`.
5. **Narrow `SECURITY DEFINER` functions** handle login, widget-key lookup, role checks, invitations and retention.
6. **Proof.** An e2e suite runs as `omniio_app` against real Postgres in CI.

## Authentication

- **Access tokens:** 15-minute JWTs, held in memory only.
- **Refresh tokens:** opaque, httpOnly `SameSite=Strict` cookies, rotated on every use. Reusing a rotated token revokes the whole token family.
- **Google sign-in:** PKCE, and never linked to an existing account by email.
- **Invitations:** single-use links.
- **MCP:** personal access tokens, accepted only on `/mcp`.

## Public surfaces

- **The widget** sees only documents and FAQs marked **public**, and is rate-limited per IP and per workspace.
- **MCP tools** run under the calling user's membership and RLS scope. Each declares annotation hints, so clients can warn before side effects.

## Reporting a vulnerability

Report privately through [GitHub security advisories](https://github.com/JawadulHadi/omni-io/security/advisories/new). See [SECURITY.md](https://github.com/JawadulHadi/omni-io/blob/main/SECURITY.md) for scope and response times.

Deep dive: [`docs/multi-tenancy.md`](https://github.com/JawadulHadi/omni-io/blob/main/docs/multi-tenancy.md).
