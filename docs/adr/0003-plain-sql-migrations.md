# ADR 0003: Plain SQL migrations instead of an ORM

- **Status:** Accepted (supersedes the Drizzle choice in the original spec)
- **Date:** 2026-09-29

## Context

The original spec named Drizzle. In practice, the schema objects that matter most here are all first-class SQL:
- RLS policies
- `SECURITY DEFINER` functions
- column-level grants
- a pgvector function with a `SET` clause

An ORM either can't express these or hides them. The scaffold's `drizzle-kit push:pg` command was also deprecated and never ran.

## Decision

- Migrations are forward-only `.sql` files in `backend/migrations/`, applied in order by a ~60-line runner (`scripts/migrate.ts`). Each file runs in one transaction, is recorded in `schema_migrations`, and is serialized with an advisory lock.
- Queries use `pg` directly through `DbService`, with parameterized SQL.

## Consequences

- The security model is readable in one place (`0003_security.sql`), which matters for review.
- There is no generated query typing. The row-mapping functions (`toDocument`, `toMember`…) are the typed boundary.
- There are no down-migrations. Fixes roll forward, which matches how production migrations are usually run.
