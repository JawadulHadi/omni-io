# Review of the v0.1.0 scaffold

- **Date:** 2026-09-29
- **Scope:** [v0.1.0](https://github.com/JawadulHadi/omni-io/releases/tag/v0.1.0), the scaffold generated from the architecture spec, and the spec itself.
- **Outcome:** 35 implementation findings and 12 spec findings. All implementation findings were fixed in v0.2.0 (backend) and v1.0.0 (console, widget). Spec findings were fixed in the v1.0.0 revision of [ARCHITECTURE.md](../ARCHITECTURE.md).

This review is published on purpose. Omni.io's case study is about designing for failure, and the scaffold's gaps are a good record of how a plausible-looking AI system can be quietly broken.

**How it was checked:** every source file was read. `tsc --noEmit` failed on the backend. `drizzle-kit push:pg` refused to run (the command is deprecated). The `''::uuid` behaviour was reproduced against Postgres 16.

## Implementation findings

### Blockers: the scaffold could not build, migrate or boot

| # | Finding | Fixed in |
| --- | --- | --- |
| 1 | Typecheck failed: `@types/pg` missing; `bcrypt` imported but not declared | 0.2.0 |
| 2 | `npm run migrate` called the deprecated `drizzle-kit push:pg` against a schema file that didn't exist, so the RLS migration never applied | 0.2.0 |
| 3 | No GraphQL resolvers, so Nest refused to boot ("Query root type must be provided") | 0.2.0 |
| 4 | `.env` never loaded; `JWT_SECRET` read at import time was `undefined` | 0.2.0 |
| 5 | `AuthService.login` queried a `users` table that didn't exist | 0.2.0 |
| 6 | The "separate" ingestion worker ran inside the API process; `worker:dev` pointed at a project that didn't exist | 0.2.0 |

### Tenant isolation was not enforced

| # | Finding | Fixed in |
| --- | --- | --- |
| 7 | `set_config(…, true)` ran as its own statement, so it was discarded immediately, and later queries used other pooled connections anyway | 0.2.0 |
| 8 | The app connected as the Postgres superuser, which bypasses RLS entirely | 0.2.0 |
| 9 | After any transaction-local set, a pooled connection reads `''`, and `''::uuid` throws; the policies lacked `nullif` | 0.2.0 |
| 10 | Pre-tenant lookups (login, widget key, cross-workspace listing, worker writes) had no path that works under RLS | 0.2.0 |
| 11 | `AuthGuard`, `RolesGuard` and `TenantInterceptor` were never registered, so nothing required authentication | 0.2.0 |
| 12 | The widget rate limit was a no-op (`ThrottlerGuard` not registered), in-memory, and per-IP only | 0.2.0 |

### Auth and authorization

| # | Finding | Fixed in |
| --- | --- | --- |
| 13 | The refresh token used the same secret and payload as the access token, so it worked as a 30-day access token; no rotation or revocation | 0.2.0 |
| 14 | Login took the first membership only (`limit 1`) | 0.2.0 |
| 15 | An admin could grant `owner` or demote an existing owner | 0.2.0 |
| 16 | Roles were read from the JWT, not the live membership row | 0.2.0 |
| 17 | AES-GCM without AAD (ciphertexts swappable between rows); key length not validated | 0.2.0 |

### The resilience ladder broke its own guarantee

| # | Finding | Fixed in |
| --- | --- | --- |
| 18 | The query embedding ran outside any `try`, so every question returned a 500 and never reached the FAQ floor | 0.2.0 |
| 19 | The Tier 1 audit write was inside Tier 1's `try`, so an audit error demoted a good answer; Tier 2 and 3 audit errors returned a 500 | 0.2.0 |
| 20 | Citations weren't validated, so hallucinated chunk ids passed; the model's JSON had no schema check | 0.2.0 |
| 21 | No timeout or circuit breaker on the model call | 0.2.0 |
| 22 | Confidence threshold hardcoded despite a per-workspace column | 0.2.0 |
| 23 | Tier 2 logged no reason; rejected Tier 1 token spend was never recorded; no decision trace | 0.2.0 |
| 24 | Tier 2 returned chunks below the similarity floor | 0.2.0 |
| 25 | FAQ matching ignored multi-word keywords and loaded every FAQ on each question | 0.2.0 |

### Ingestion

| # | Finding | Fixed in |
| --- | --- | --- |
| 26 | Document status never left `processing`; no retries | 0.2.0 |
| 27 | Up to 20 MB of raw text stored in Redis job payloads and kept forever, a GDPR erasure leak | 0.2.0 |
| 28 | Re-ingesting a shorter document left stale chunks | 0.2.0 |
| 29 | IVFFlat built on an empty table, with post-filtering by tenant, so small tenants got fewer than k results | 0.2.0 |
| 30 | One sequential embedding call per chunk | 0.2.0 |

### Frontend

| # | Finding | Fixed in |
| --- | --- | --- |
| 31 | No PostCSS or Tailwind plugin, so the UI was unstyled; no shadcn/ui | 1.0.0 |
| 32 | The Vite proxy key `/w` also captured the console's `/widget` route | 1.0.0 |
| 33 | The widget was never mounted, had no bundle, and used relative URLs that would hit the customer's own site | 1.0.0 |
| 34 | The playground sent no auth, didn't use urql, and crashed on errors | 1.0.0 |
| 35 | Five of six screens were stubs; no login; no code splitting | 1.0.0 |

Also fixed in 0.2.0: the exception filter crashed on GraphQL errors (`res.status is not a function`), there was no input validation, the widget query length was unbounded, and CORS was fully open.

## Spec findings (all fixed in the v1.0.0 spec revision)

1. Cross-references to section numbers that didn't exist; two diagram placeholders.
2. "Never blocks the request thread" is a Java-ism, and routing answers through BullMQ contradicts the synchronous `askQuestion` ([ADR 0004](../adr/0004-sync-answers-queued-ingestion.md)).
3. The RLS section omitted the parts that make RLS real: a non-owner role, per-transaction context, the `nullif` gotcha, and the pre-tenant path ([ADR 0001](../adr/0001-tenant-isolation-in-postgres.md), [0002](../adr/0002-short-tenant-transactions.md)).
4. "Drizzle typed end-to-end into GraphQL" overclaimed ([ADR 0003](../adr/0003-plain-sql-migrations.md)).
5. The Tier 1 gate relied on the model's self-reported confidence alone, with no evaluation plan.
6. Tier 2 would show internal document excerpts to anonymous widget users; documents need a visibility setting.
7. No treatment of prompt injection ([ADR 0005](../adr/0005-model-output-is-untrusted.md)).
8. Hardcoded `vector(768)` while also asking which embedding provider to use.
9. `widget_key` defined in two tables.
10. GDPR erasure "in one transaction" can't include files, Redis, backups or provider logs.
11. MCP over the deprecated SSE transport ([ADR 0008](../adr/0008-mcp-streamable-http.md)).
12. No observability or per-workspace cost ceilings (now on the roadmap).
