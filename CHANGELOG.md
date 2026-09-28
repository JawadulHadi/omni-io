# Changelog

All notable changes to Omni.io are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for 1.0.0

- Admin console (playground, documents, ingestion, FAQs, members, widget, audit).
- Embeddable Shadow-DOM widget and hosted chat page.
- Documentation set, ADRs, CI and community health files.

## [0.2.0] - 2026-09-29

The hardened backend. The scaffold now builds, migrates and boots, tenant isolation is enforced by Postgres, and the resilience ladder never throws.

### Added

- `omniio_app` database role (not the owner, not a superuser, `NOBYPASSRLS`) and `DbService`, which runs one short tenant transaction per unit of work and fails closed without a tenant.
- An AsyncLocalStorage `TenantContext`, filled by `AuthGuard` or entered explicitly with `withWorkspace()`.
- `SECURITY DEFINER` lookups: `auth_find_user`, `user_workspaces`, `workspace_role`, `resolve_widget_key`.
- Column-level grants on `users`, so the app can't read `password_hash` directly.
- Migrations `0002_schema.sql` and `0003_security.sql`:
  - `users` and `refresh_tokens` tables
  - document `content`, `storage_key`, `visibility`, `error` and `chunk_count`
  - `answers.decision_trace`, `channel`, `top_similarity` and `latency_ms`
  - an HNSW index
  - `match_chunks` with public-only filtering and iterative scan
- A Gemini provider (`gemini-3.5-flash` for chat; `gemini-embedding-2` at 768 dimensions with task instructions) behind an `AiProvider` interface.
- A deterministic fake provider with `[fail:*]` markers for tests and demos.
- Resilience ladder:
  - schema-validated model output
  - citation ⊆ retrieved check
  - per-workspace confidence threshold and similarity floor
  - hard timeout, circuit breaker and a decision trace
  - fire-and-forget audit through an event listener
- Ingestion:
  - a separate worker process (`src/worker.ts`)
  - retries with exponential backoff and status transitions
  - batched embeddings and idempotent chunk replacement
  - live progress over a GraphQL subscription
  - original files kept in `BlobStorage`
- Auth:
  - 15-minute access tokens with `typ: "access"`
  - opaque rotating refresh tokens in an httpOnly cookie, with family revocation on reuse
  - live role checks
  - workspace switching
  - Google OAuth (PKCE)
  - registration
- GraphQL resolvers for workspaces, members, documents, FAQs, answers, audit and widget config.
- REST endpoints: `/auth/*`, `/documents/upload`, `/w/:key/config`, `/w/:key/ask`, `/health`.
- MCP over Streamable HTTP (`/mcp`) with `list_workspaces`, `list_documents`, `list_faqs` and `ask_question`, scoped to the caller.
- GDPR erasure: one transaction removes the document, its vectors and its audit references; the file is deleted after commit, with retry.
- Widget key rotation and theming.
- Redis-backed rate limits per IP and per widget key.
- Configuration validated at boot (zod), global `ValidationPipe`, input size limits.
- Tests: 58 unit tests (every ladder branch, circuit breaker, chunking, crypto, auth guard, prompt hygiene) and 9 RLS integration tests against real Postgres.
- `npm run migrate` (a small SQL runner) and `npm run seed`.

### Changed

- **Breaking:** Drizzle replaced by plain SQL migrations in `backend/migrations/`, applied as `DATABASE_MIGRATOR_URL`.
- **Breaking:** `DATABASE_URL` must be the `omniio_app` role.
- **Breaking:** the widget config endpoint moved from `GET /w/:key` to `GET /w/:key/config`.
- Backend modules reorganised into NestJS feature modules; TypeScript uses `node16` module resolution.
- FAQ matching moved into SQL, with whole-word and phrase keywords normalized on write.
- Passwords hashed with scrypt from `node:crypto`, so there is no native addon to build.

### Fixed

- Everything listed as "Fixed in 0.2.0" in [the scaffold review](https://github.com/JawadulHadi/omni-io/blob/main/docs/reviews/2026-09-29-scaffold-review.md). Most notably:
  - RLS was bypassed (superuser connection, lost `set_config`, the `''::uuid` error on reused connections).
  - Every question returned a 500.
  - Refresh tokens worked as access tokens.
  - Owner escalation was possible.
  - Raw document text was kept in Redis.
  - The exception filter crashed on GraphQL errors.

### Security

- Connector secrets now bind their row identity as AES-GCM additional authenticated data, and the key length is validated.
- Prompt-injection hygiene: delimited passages, neutralized delimiters, schema-constrained output, citation validation. Anonymous widget users can only retrieve documents marked public.

### Removed

- `drizzle-orm`, `drizzle-kit`, `bcrypt`, `@nestjs/passport`, `passport-jwt` and `TenantInterceptor`.

## [0.1.0] - 2026-09-28

### Added

- The initial scaffold generated from the architecture spec: NestJS modules, a first SQL migration with RLS policies and `match_chunks`, a draft resilience ladder, BullMQ ingestion, a React/Vite shell, and the original spec.

### Known issues

- It does not build, migrate or boot; RLS is not enforced; every question returns HTTP 500. See [the scaffold review](https://github.com/JawadulHadi/omni-io/blob/main/docs/reviews/2026-09-29-scaffold-review.md).

[Unreleased]: https://github.com/JawadulHadi/omni-io/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/JawadulHadi/omni-io/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/JawadulHadi/omni-io/releases/tag/v0.1.0
