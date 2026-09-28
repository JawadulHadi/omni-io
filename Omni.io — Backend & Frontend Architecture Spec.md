# Omni.io — Backend & Frontend Architecture Spec

Sep 28, 2026 · @Jawad Ul Hadi

## Why this version

The live `omniioo` repo was scaffolded with Lovable: fast to demo, but the stack (TanStack Start + Supabase-only) doesn't match the NestJS/PostgreSQL/GraphQL/BullMQ/Redis skill set the resume and case study lead with. This spec redesigns the same product — a multi-tenant AI support engine with a cited-answer → RAG-snippet → FAQ-floor resilience ladder — on a stack an interviewer can map directly onto "Backend Lead / Architect."

This is a build spec, not a changelog: it assumes a fresh NestJS backend and a separate React frontend, reusing only the product concept and data model ideas from the original.

**Who this is for:** (1) a hiring-manager-facing architecture doc to accompany the "Designing for AI Failure" case study, and (2) an actual scaffold — Section 8 is a single prompt that hands this whole spec to an AI coding tool (Claude Code, Cursor) to generate the codebase.

## System overview

&#91;embedded content: request path · gateway to workers\]

One NestJS gateway sits in front of everything; a sync path serves CRUD and console reads directly, while ingestion and answer generation go through BullMQ/Redis and the LLM gateway so a slow embed or a rate-limited model call never blocks the request thread.

## Backend: NestJS modules

Each module is a NestJS feature module with its own controller/resolver, service, and DTOs; `TenantInterceptor` reads the workspace from the JWT and sets it as a Postgres session variable so RLS enforces isolation at the database layer, not just in application code.

| Module | Responsibility | Key interfaces |
| --- | --- | --- |
| `AuthModule` | Email + OAuth login, JWT issue/refresh | REST: `/auth/login`, `/auth/refresh` |
| `WorkspacesModule` | Tenant CRUD, member roles (owner/admin/editor/viewer) | GraphQL: `workspace`, `inviteMember` |
| `DocumentsModule` | Upload, list, delete source documents | GraphQL mutations + REST upload endpoint |
| `IngestionModule` | Enqueues chunk/embed jobs, exposes job status | BullMQ producer; GraphQL subscription for progress |
| `IngestionWorker` | Separate process: chunks (1,200 char / 200 overlap), calls embeddings, upserts to pgvector, idempotent by `${documentId}:${chunkIndex}` | BullMQ consumer |
| `AnswerModule` | Runs the resilience ladder (Section 5) for a query | GraphQL: `askQuestion` |
| `FaqModule` | Deterministic FAQ floor, keyword match | GraphQL CRUD |
| `WidgetModule` | Public, unauthenticated endpoint scoped by rotating widget key | REST: `/w/:key/ask` |
| `AuditModule` | Writes model, tokens, retrieved chunks, cited chunks, FAQ match, decision trace per answer | Internal event listener, no public API |
| `McpModule` | Exposes `list_workspaces`, `list_documents`, `list_faqs`, `ask_question` to external AI assistants under the signed-in user's RLS scope | MCP server over SSE |

**Cross-cutting:** `@nestjs/throttler` for per-workspace rate limits, `class-validator` DTOs on every mutation, a global `AllExceptionsFilter` that never leaks stack traces past the API boundary.

## Data model

Every tenant-owned table carries `workspace_id` and a Postgres RLS policy of the form `USING (workspace_id = current_setting('app.workspace_id')::uuid)`. Migrations are managed with Drizzle so the schema stays typed end-to-end into the GraphQL layer.

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `workspaces` | Tenant root | `id`, `name`, `plan`, `widget_key` |
| `workspace_members` | Role binding | `workspace_id`, `user_id`, `role` |
| `documents` | Source uploads | `id`, `workspace_id`, `status`, `source_type` |
| `chunks` | Embedded text | `id` (`${documentId}:${chunkIndex}`), `embedding vector(768)`, `content`, `workspace_id` |
| `faqs` | Deterministic floor | `workspace_id`, `question`, `answer`, `keywords[]` |
| `answers` | Audit log | `query`, `tier_used`, `model`, `tokens_in/out`, `cited_chunk_ids[]`, `confidence` |
| `widget_configs` | Public embed | `workspace_id`, `key`, `theme`, `rotated_at` |

A `match_chunks` Postgres function does the vector similarity search server-side (`embedding <=> query_embedding`), filtered by `workspace_id` inside the same SQL statement — never in application code — so a bug in the service layer can't leak another tenant's vectors.

## RAG pipeline & resilience ladder

&#91;embedded content: resilience ladder · 3 tiers\]

The ladder is one service method, not three separate code paths, so a failure at any tier degrades gracefully instead of returning an error to the customer. Tier 1 requires the model to return valid structured JSON with real citations above the workspace's confidence threshold; anything else — a timeout, malformed output, low confidence — falls to Tier 2 automatically, and a similarity floor of 0.6 on retrieval falls further to Tier 3.

## Frontend architecture

React 19 + Vite, TypeScript, Tailwind, shadcn/ui. GraphQL client (urql or Apollo) talks to the NestJS gateway; the public widget is a separate, minimal bundle so a customer's page never loads the admin console's weight.

| Area | Structure | Notes |
| --- | --- | --- |
| `app/console/` | Route per admin screen: documents, ingestion, playground, FAQs, members, widget config, answer audit | Route-level code splitting |
| `app/widget/` | Standalone embeddable chat UI served at `/w/:key` | No auth; scoped entirely by the public widget key |
| `state/` | Server state via GraphQL cache (urql/Apollo); local UI state via component state or Zustand — no global Redux store | Avoids the boilerplate a CRUD-heavy console doesn't need |
| `components/ingestion/` | Upload dropzone, per-job progress bar, retry button | Subscribes to ingestion progress over a GraphQL subscription |
| `components/playground/` | Query box + tier badge (which rung of the ladder answered) + citation list | Mirrors the audit log so support staff can see *why* an answer looked the way it did |
| `components/audit/` | Filterable table over the `answers` log | Cost and fairness review, matches Section 4's `answers` table |

Accessibility and empty/error states are treated as first-class per screen (empty ingestion queue, zero FAQs, widget key rotated mid-session) rather than left to a generic loading spinner.

## Security, auth & multi-tenancy

- **Isolation is enforced at the database, not the app layer.** Every table has `workspace_id` + an RLS policy; `TenantInterceptor` sets `app.workspace_id` from the verified JWT on every request before any query runs, so a missed `.where()` clause in a service can't cross tenants.
- **Auth:** short-lived JWT access token + rotating refresh token, `AuthGuard` on every resolver/controller except the widget and MCP OAuth callback routes.
- **Roles:** `owner / admin / editor / viewer` enforced by a `@Roles()` decorator + guard, checked against `workspace_members`.
- **Secrets:** third-party connector keys (Google Drive, LLM provider) stored AES-256-GCM encrypted per user, never in plaintext, decrypted only inside the request that needs them.
- **Widget security:** the public embed authenticates by a rotating opaque key scoped to one workspace and revocable without affecting the admin console session.
- **GDPR:** a `deleteByRef` path removes a document's vectors, original file and audit metadata in one transaction — no orphaned embeddings after erasure.
- **Rate limiting:** per-workspace and per-IP throttling on the widget route specifically, since it's the only unauthenticated surface.

## Build prompt

Paste this into Claude Code, Cursor, or another agentic coding tool to scaffold the backend and frontend from this spec. It intentionally does not name a UI kit theme or exact LLM provider so the tool asks before assuming.

```markdown
Build "Omni.io": a multi-tenant AI customer-support knowledge engine.

STACK
- Backend: NestJS (TypeScript), GraphQL (code-first, @nestjs/graphql), PostgreSQL + pgvector, Drizzle ORM/migrations, Redis, BullMQ for background jobs.
- Frontend: React 19 + Vite + TypeScript, Tailwind CSS, shadcn/ui, a GraphQL client (urql or Apollo — pick one and justify it).
- Auth: JWT access + refresh tokens, email/password plus Google OAuth.

CORE PRODUCT
Each "workspace" (tenant) uploads documents (PDF/txt/md up to 20MB) or pastes text. The system chunks (1,200 chars, 200 overlap, stable id "${documentId}:${chunkIndex}", idempotent upsert), embeds each chunk, and stores vectors in Postgres via pgvector.

When a customer asks a question, run a 3-tier resilience ladder as ONE service method (not three branches bolted together):
1. Tier 1 — retrieve top-k chunks, ask the LLM for a JSON answer with numbered citations; accept only if valid JSON, real citations, and confidence >= the workspace's threshold.
2. Tier 2 — if the model errors, returns invalid JSON, or confidence is too low: return the top 3 retrieved chunks verbatim instead.
3. Tier 3 — if retrieval similarity is below 0.6 (nothing relevant found): fall back to a deterministic keyword-matched FAQ, or a safe human hand-off message.
Log every answer's tier used, model, token usage, retrieved chunk ids, cited chunk ids, FAQ match (if any), and full decision trace to an audit table.

MULTI-TENANCY & SECURITY (non-negotiable)
- Every tenant-owned table has a workspace_id column and a Postgres row-level security policy filtering on it — enforce isolation in the database, not just in application code.
- A NestJS interceptor sets the current workspace as a Postgres session variable from the verified JWT before any query runs.
- Roles: owner / admin / editor / viewer, enforced by a guard checked against workspace membership on every mutation.
- Encrypt any stored third-party connector API keys with AES-256-GCM per user; never store plaintext.
- Support a GDPR-style erasure endpoint that deletes a document's vectors, original file, and metadata in one transaction.

FEATURES TO INCLUDE
- Document upload + ingestion with per-job progress and retry on failure.
- Admin console: documents, ingestion status, a Q&A playground showing which tier answered and why, FAQ management, member/role management, widget appearance config, and an answer-audit table.
- A public embeddable widget at a per-workspace URL, authenticated by a rotating opaque key, with a copy-paste embed script.
- Rate limiting on the public widget endpoint specifically (it's the only unauthenticated surface).
- An MCP server exposing list_workspaces, list_documents, list_faqs, and ask_question tools, running under the calling user's own row-level-security scope.

DELIVERABLES
- A working NestJS backend with the modules above, GraphQL schema, and Drizzle migrations (including the RLS policies and a match_chunks SQL function for vector search).
- A working React frontend implementing the console and widget.
- A README explaining setup, environment variables, and how the resilience ladder degrades.
- Ask me before choosing: the specific LLM/embedding provider, the GraphQL client library, and the hosting target — don't assume defaults for these.
```

If you'd rather I build this directly instead of handing off the prompt, say so and I'll scaffold it in the container step by step — that's a longer job (proper NestJS + Drizzle + a working RAG pipeline is not a single-file exercise), so it's worth confirming you want that over the AI-tool route above.
