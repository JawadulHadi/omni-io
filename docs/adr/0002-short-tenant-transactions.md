# ADR 0002: One short transaction per unit of work, never across a model call

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

`set_config('app.workspace_id', …, true)` is transaction-local. The tenant must therefore be set inside the same transaction, on the same pooled connection, as the queries it protects.

The simplest approach is one transaction per request. But a request that calls an LLM can take seconds. Holding a connection and an open transaction for that long starves the pool for every tenant.

## Decision

- `DbService.tenant(fn)` checks out a client, runs `BEGIN` → `set_config` → `fn` → `COMMIT`, then releases it. `DbService.query()` is the shorthand for a single statement.
- The tenant id comes from an AsyncLocalStorage `TenantContext`:
  - `AuthGuard` fills it for authenticated requests.
  - The widget, worker and MCP enter a workspace explicitly with `withWorkspace()`.
- With no workspace in context, `tenant()` throws (fail closed).
- The answer ladder does its reads in short transactions, calls the model while holding no connection, and writes the audit row off the response path.

## Consequences

- Connections are held for milliseconds, so pool sizing doesn't depend on model latency.
- A multi-step write that must be atomic has to use a single `tenant()` block. Erasure, member changes and chunk replacement all do.
- Each unit of work adds `BEGIN`, `set_config` and `COMMIT` round-trips, which is negligible next to a model call.
