# ADR 0001: Enforce tenant isolation in Postgres with a non-owner app role

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Omni.io is multi-tenant. Application-level filtering (`WHERE workspace_id = $1` in every query) fails open: one forgotten clause leaks another customer's documents.

The v0.1.0 scaffold declared RLS policies, but they never applied, for two reasons:
- It connected as the Postgres superuser, which bypasses RLS entirely.
- It set the tenant variable outside the query's transaction.

## Decision

- Every tenant-owned table has RLS, with a `USING` + `WITH CHECK` policy on `nullif(current_setting('app.workspace_id', true), '')::uuid`.
- The API and worker connect as `omniio_app` (`NOSUPERUSER`, `NOBYPASSRLS`, not the owner). Migrations run as the owner.
- RLS is enabled, not forced. The only cross-tenant access is four narrow `SECURITY DEFINER` functions, each with a pinned `search_path`, for lookups that happen before a tenant is known.

## Consequences

- A missing `WHERE` clause returns nothing rather than someone else's data. An integration test against real Postgres proves this.
- Every new tenant table needs a policy and explicit grants (see the checklist in [multi-tenancy.md](../multi-tenancy.md)).
- The definer functions are privileged code, so they are kept deliberately tiny.
