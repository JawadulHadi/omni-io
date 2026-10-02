# Changelog

All notable changes to Omni.io are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Tier-mix and latency metrics (OpenTelemetry) with alerting on fallback rate.
- A Redis-backed circuit breaker shared across API instances.
- A per-workspace evaluation set for tuning confidence and similarity thresholds.
- Email verification, so invitations and Google sign-in can be bound to an address.
- MCP OAuth 2.1 authorization.
- GraphQL codegen for console types.
- An S3/GCS driver for `BlobStorage`.

## [1.1.0] - 2026-10-02

Deployment hardening and security fixes. The build is green again on the upgraded dependencies, and the stack deploys with one command.

### Fixed

- **The build.** The dependency upgrades merged after 1.0.0 had broken install, typecheck, build and tests on `main`:
  - Nest 12 is ESM-only. The backend now compiles with `module: NodeNext` and loads it through `require(esm)`; Jest runs with `--experimental-vm-modules`.
  - TypeScript 7 ships no compiler API, so the toolchain is on TypeScript 6.
  - `@nest-lab/throttler-storage-redis` doesn't support Nest 12 and is replaced by our own Redis storage.
  - Apollo 5 needs `@as-integrations/express5`.
  - React Router 7 dropped the `future` prop.
  - Vite 8 ignores esbuild's `charset: 'ascii'`, so the widget bundle is now escaped after the build.
  - The frontend lockfile is back in sync.
- **Google sign-in could take over accounts.** It linked a Google identity to any existing password account with the same email. Because sign-up doesn't verify email ownership, whoever registered the address first kept the password to the real owner's account. It now refuses, and the console points the user to password sign-in.
- **Anonymous widget visitors could get internal FAQ answers** from Tier 3. FAQs now have a visibility setting; existing FAQs stay public and new ones start internal.
- **The question embedding had no timeout**, so a hanging embedding API hung every question. Retrieval now has its own time budget and circuit breaker, and degrades to Tier 3.
- **The half-open circuit breaker let every concurrent request through.** It now lets exactly one probe through.
- **Postgres down made the widget return 500s.** It now answers with the hand-off message (and default theme).
- **Redis down made widget and auth requests hang or fail** in the rate limiter. Limits now fall back to per-process counters.
- **Uploads with Redis down hung on BullMQ** and left the document pending forever. They are now saved as `failed` with a Retry button.
- **PDF parsing ran on the API's event loop.** It now runs in a worker thread with a 30-second limit, a 512 MB heap cap and at most two at a time.
- **Small tenants could get fewer than k vector-search results in a large shared table** once HNSW's iterative scan hit `hnsw.max_scan_tuples`. `match_chunks` now falls back to an exact search for that tenant.
- **Removed members kept receiving live ingestion events** until their socket closed. Membership is now re-checked as events arrive.
- **Erasure could silently leave originals behind.** Original uploads were stored on local disk, never read back, and deleted with `force: true`, so in a multi-host setup a delete could miss them and report success. Originals are no longer kept by default (`STORAGE_DRIVER=none`).

### Added

- **Invite links.** `inviteMember`, which added any registered account without consent and revealed whether an email had an account, is replaced by `createInvitation`. It makes single-use links valid for 7 days that the invitee accepts at `/invite/<token>`. New `invitations`, `revokeInvitation` and `acceptInvitation` operations, and invite-aware register, login and Google sign-in.
- **Personal access tokens for MCP** (`omni_pat_…`), managed under **API tokens** in the console. They are accepted only on `/mcp`.
- **Cost ceilings**, so spend can no longer grow without limit:
  - `TIER1_DAILY_LIMIT_PER_WORKSPACE`: when it runs out, answers come from Tier 2 (`tier1_budget_exhausted`).
  - `ASK_LIMIT_PER_USER` for the console and MCP.
  - `INGEST_LIMIT_PER_WORKSPACE`.
  - `MAX_WORKSPACES_PER_USER`.
  - `ALLOW_SIGNUP=false` for invite-only sign-up.
- **A grounding check on Tier 1.** At least `TIER1_MIN_GROUNDING` of the answer's content words must appear in its cited passages (`tier1_ungrounded`).
- **Answer-audit retention** (`ANSWER_RETENTION_DAYS`, default 90). The worker sweeps every six hours, and also removes expired invitations and tokens.
- `/health` reports Postgres and Redis separately: 200 `degraded` without Redis, 503 without Postgres.
- A server-side `statement_timeout` (`DB_STATEMENT_TIMEOUT_MS`).
- The API refuses to start in production with `COOKIE_SECURE=false` or the example `JWT_SECRET`.
- **Deployment:** `deploy/` has a backend image (API, worker, migrations), a Caddy web image (console plus same-origin API proxy with automatic HTTPS) and a Docker Compose file for one server. CI now builds both images.
- Migration `0004_hardening.sql`, with integration tests for invitations, the vector-search fallback and retention.
- **MCP tool metadata.** Every tool now declares a `title`, an input schema and all four annotation hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). `ask_question` is marked as not read-only and open-world, because it writes an audit row, spends the model-call budget and calls the provider. `mcp.tools.spec.ts` exercises all four tools through a real MCP client.
- **Documentation.**
  - An [architecture document](docs/gist/omni-io-architecture.md) with 14 Mermaid diagrams, ready to publish as a GitHub gist.
  - A [production-readiness review](docs/reviews/2026-10-02-production-readiness-review.md) with a phased plan to go live.
  - [Wiki pages](docs/wiki/) and a script to publish them.
  - [Repository settings](docs/maintainers/repository-settings.md): description, topics, the release process and security settings.

### Changed

- Node 24 LTS (`.nvmrc`). The app needs 22.12 or later.
- The migration runner moved to `src/migrate.ts`, so production images run it as `node dist/migrate.js`.
- Dependabot no longer proposes major upgrades. They need a deliberate migration.

### Removed

- `ConnectionsService`, `APP_USER_CONNECTION_KEY_SECRET` and the `app_user_connections` table. Nothing ever used them.

## [1.0.0] - 2026-09-29

The first stable release: the admin console, the embeddable widget, documentation and CI on top of the 0.2.0 backend.

### Added

- **Admin console** (React 19, Tailwind v4, shadcn/ui, urql) with route-level code splitting:
  - Playground: tier badge, citations, decision trace, ladder settings, failure-injection shortcuts.
  - Documents: drag-and-drop upload, paste, visibility, live progress, retry, GDPR erasure.
  - Ingestion: live job queue.
  - FAQs: CRUD.
  - Members: roles, invitations and removal, with escalation rules mirrored in the UI.
  - Widget: theme, key rotation, copyable embed snippet, hosted-page link.
  - Answer audit: filters, tier distribution, token totals, expandable trace.
  - Sign-in and account creation, including Google.
- Session handling with the access token in memory, silent refresh through the httpOnly cookie, single-flight refresh within a tab and Web-Locks serialization across tabs, and a workspace switcher.
- One shared `ingestionProgress` subscription drives live progress across screens.
- **Embeddable widget**: a standalone IIFE bundle (`dist/widget.js`) rendered in a Shadow DOM, with absolute API URLs and states for loading, rate limiting and a rotated key. It stays invisible if the key is invalid at load.
- Hosted full-page chat at `/w/:key`.
- The Omni.io brand mark, wordmarks and favicon.
- Documentation:
  - revised architecture spec
  - resilience-ladder and multi-tenancy deep dives
  - API reference
  - deployment guide
  - eight ADRs
  - the published v0.1.0 review
  - release notes
  - a sample knowledge base
- Project health files: CI workflow, Dependabot, issue and PR templates, CODEOWNERS, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.editorconfig`, `.gitattributes`, `.nvmrc`.

### Fixed

- Chunk starts are now aligned to word boundaries; overlap previously began mid-word.
- PDF text is joined page by page, without the `-- 1 of N --` markers that leaked into citations.
- The fake provider now returns the passage sentences most related to the question, with markdown headings removed, instead of the chunk's first sentences.
- The widget bundle is emitted as ASCII, so `×` and `…` render correctly on pages without a UTF-8 charset.
- The Vite dev proxy no longer captures the console's `/widget` route (regex proxy keys).
- The console no longer triggers a React "setState while rendering another component" warning from two routes sharing one urql operation.

### Changed

- Node 22 LTS is the recommended runtime (`.nvmrc`); Node 20.16+ remains supported.

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

[Unreleased]: https://github.com/JawadulHadi/omni-io/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/JawadulHadi/omni-io/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/JawadulHadi/omni-io/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/JawadulHadi/omni-io/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/JawadulHadi/omni-io/releases/tag/v0.1.0
