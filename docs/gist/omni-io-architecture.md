# Omni.io — System Architecture

**AI customer support that degrades gracefully instead of failing.** Multi-tenant RAG on NestJS, PostgreSQL row-level security + pgvector, BullMQ, Gemini and React.

Jawad Ul Hadi · Backend Lead & Architect · October 2026 · v1.0.0 + unreleased deployment hardening

Source: [github.com/JawadulHadi/omni-io](https://github.com/JawadulHadi/omni-io) · Case study: *Designing for AI Failure* · [ADRs](https://github.com/JawadulHadi/omni-io/tree/main/docs/adr)

---

## Contents

1. [The problem and the design principle](#1-the-problem-and-the-design-principle)
2. [System context](#2-system-context)
3. [Runtime containers](#3-runtime-containers)
4. [Backend module map](#4-backend-module-map)
5. [Request pipeline](#5-request-pipeline)
6. [The resilience ladder](#6-the-resilience-ladder)
7. [Asking a question, end to end](#7-asking-a-question-end-to-end)
8. [Ingestion pipeline](#8-ingestion-pipeline)
9. [Data model](#9-data-model)
10. [Tenant isolation](#10-tenant-isolation)
11. [Authentication and sessions](#11-authentication-and-sessions)
12. [Public widget](#12-public-widget)
13. [MCP server for AI assistants](#13-mcp-server-for-ai-assistants)
14. [Deployment topology](#14-deployment-topology)
15. [Failure matrix](#15-failure-matrix)
16. [Technology stack and decisions](#16-technology-stack-and-decisions)

---

## 1. The problem and the design principle

Most RAG systems have one mode: working. If the embedding API is down, the model times out, or the model cites a passage it never saw, the customer gets either an error or a confident fabrication.

Omni.io follows three rules:

| Rule | How it is enforced |
| --- | --- |
| **Every question gets an answer** | A three-tier ladder in one service method that never throws: cited AI answer → verbatim excerpts → FAQ or human hand-off |
| **Every answer explains itself** | A step-by-step decision trace, stored in the audit log and shown to support staff |
| **Tenants can't see each other's data, even through a bug** | Postgres row-level security under a `NOBYPASSRLS` role, tested against a real database |

---

## 2. System context

```mermaid
flowchart LR
  subgraph People
    OP["Support team<br/>(owner · admin · editor · viewer)"]
    VIS["Customer's website visitor<br/>(anonymous)"]
    AIA["AI assistant<br/>(Claude, Cursor, etc.)"]
  end

  subgraph Omni["Omni.io"]
    SYS["Multi-tenant AI support engine"]
  end

  subgraph External
    GEM["Google Gemini<br/>chat + embeddings"]
    GOO["Google OAuth<br/>(optional)"]
  end

  OP -- "Admin console<br/>GraphQL + WebSocket" --> SYS
  VIS -- "Embedded widget<br/>REST /w/:key" --> SYS
  AIA -- "MCP · Streamable HTTP<br/>personal access token" --> SYS
  SYS -- "embed · generate" --> GEM
  SYS -- "PKCE sign-in" --> GOO
```

There are three ways in, each with its own trust level:

| Channel | Caller | Authentication | What it can see |
| --- | --- | --- | --- |
| Console | Workspace members | 15-minute JWT + rotating refresh cookie | Everything their role allows |
| Widget | Anonymous visitors | Public, rotatable widget key | Only documents and FAQs marked **public** |
| MCP | AI assistants acting for a user | `omni_pat_…` personal access token | Exactly what that user can see |

---

## 3. Runtime containers

```mermaid
flowchart TB
  subgraph Edge["Edge · Caddy (auto-HTTPS)"]
    CAD["Static console + widget.js<br/>reverse proxy"]
  end

  subgraph App["Application tier"]
    API["NestJS API<br/>GraphQL · REST · MCP · WebSocket<br/>(stateless, horizontally scalable)"]
    WRK["Ingestion worker<br/>separate Node process<br/>chunk · embed · retention sweep"]
  end

  subgraph Data["Data tier"]
    PG[("PostgreSQL 16 + pgvector 0.8<br/>RLS · HNSW · SECURITY DEFINER fns")]
    RD[("Redis 7<br/>BullMQ · rate limits · budgets · progress")]
  end

  GEM["Gemini API"]

  CAD -- "/graphql /auth/* /mcp /w/:key/* /health" --> API
  API -- "enqueue job (ids only)" --> RD
  RD -- "jobs" --> WRK
  WRK -. "progress events" .-> RD
  RD -. "QueueEvents → GraphQL subscription" .-> API
  API -- "omniio_app role" --> PG
  WRK -- "omniio_app role" --> PG
  API -- "query embedding + Tier 1 generation<br/>(timeout + circuit breaker)" --> GEM
  WRK -- "batch embeddings" --> GEM
```

**Why ingestion is queued but answering is synchronous.** The split follows failure semantics, not threading:

- **Ingestion** is long and retryable, and nobody is waiting on it. BullMQ gives durability, retries with backoff, and backpressure. A separate process means a 20 MB PDF can't starve the API of CPU, memory or DB connections.
- **Answering** has a customer waiting. It runs inline under a hard time budget with circuit breakers. The worst case is a fast Tier 2 answer, never a queue.

---

## 4. Backend module map

```mermaid
flowchart LR
  subgraph Entry["Entry points"]
    GQL["GraphQL resolvers"]
    REST["REST controllers"]
    MCPC["MCP controller"]
  end

  subgraph Features
    AUTH["AuthModule<br/>login · register · refresh · Google"]
    TOK["ApiTokensModule<br/>MCP PATs"]
    WS["WorkspacesModule<br/>members · roles · invites · ladder settings"]
    DOC["DocumentsModule<br/>upload · paste · visibility · erasure"]
    ING["IngestionModule<br/>producer · progress relay"]
    ANS["AnswerModule<br/>resilience ladder"]
    FAQ["FaqModule<br/>Tier 3 floor"]
    WID["WidgetModule<br/>public key · theme · rotation"]
    AUD["AuditModule<br/>answer.completed listener"]
    MCP["McpModule<br/>4 tools"]
    HLT["HealthModule<br/>/health · systemInfo"]
  end

  subgraph Infra["Shared infrastructure"]
    DB["DbService<br/>tenant() · withWorkspace() · global()"]
    AI["AiProvider<br/>Gemini | Fake"]
    RL["Redis rate limiter<br/>+ in-process fallback"]
    BS["BlobStorage<br/>none | local"]
  end

  GQL --> AUTH & TOK & WS & DOC & ANS & FAQ & WID & AUD
  REST --> AUTH & DOC & WID & HLT
  MCPC --> MCP
  MCP --> WS & DOC & FAQ & ANS
  WID --> ANS
  ANS -- "emits answer.completed" --> AUD
  DOC --> ING
  ANS --> AI
  ANS & DOC & FAQ & WS & AUD & AUTH --> DB
  WID & AUTH & ANS --> RL
  DOC --> BS
```

| Module | Main operations |
| --- | --- |
| `AuthModule` | `POST /auth/login · /register · /refresh · /switch-workspace · /logout · /google` |
| `ApiTokensModule` | `apiTokens`, `createApiToken`, `revokeApiToken` |
| `WorkspacesModule` | `workspace`, `myWorkspaces`, `createInvitation`, `acceptInvitation`, `updateMemberRole`, `updateLadderSettings` |
| `DocumentsModule` | `POST /documents/upload`, `documents`, `createDocumentFromText`, `deleteDocument` |
| `IngestionModule` | BullMQ producer, `ingestionProgress` subscription |
| `AnswerModule` | `askQuestion` |
| `FaqModule` | FAQ CRUD |
| `WidgetModule` | `GET /w/:key/config`, `POST /w/:key/ask`, `widgetConfig`, `rotateWidgetKey` |
| `AuditModule` | Internal listener; read-only `answers` |
| `McpModule` | `POST /mcp`: `list_workspaces`, `list_documents`, `list_faqs`, `ask_question` |

---

## 5. Request pipeline

Every request passes the same gates in a fixed order. No feature code can skip them.

```mermaid
flowchart LR
  R["HTTP / WS request"] --> TC["TenantContext middleware<br/>opens AsyncLocalStorage scope"]
  TC --> CP["cookie-parser · JSON body 2 MB"]
  CP --> AG{"AuthGuard<br/>@Public?"}
  AG -- "public route" --> RG
  AG -- "JWT valid<br/>(PAT only on /mcp)" --> FILL["fill context:<br/>userId · workspaceId"]
  AG -- "invalid" --> X401["401"]
  FILL --> RG{"RolesGuard<br/>@Roles(min) vs<br/>LIVE membership row"}
  RG -- "insufficient" --> X403["403"]
  RG -- "ok" --> VP["ValidationPipe<br/>whitelist · forbidNonWhitelisted"]
  VP --> H["Resolver / controller"]
  H --> DBS["DbService.tenant()<br/>BEGIN · set_config(app.workspace_id, local) · queries · COMMIT"]
  H -. "any error" .-> EF["AllExceptionsFilter<br/>sanitized, no stack traces"]
```

Roles are checked against the **live** `workspace_members` row on every request, not against JWT claims. A demotion or removal takes effect on the next request, not when the token expires.

---

## 6. The resilience ladder

One method, `AnswerService.askQuestion()`, never throws. Every branch appends to the decision trace.

```mermaid
flowchart TD
  Q(["Question ≤ 1,000 chars"]) --> RB{"Retrieval breaker open?"}
  RB -- "yes" --> T3
  RB -- "no" --> E["Embed query + match_chunks<br/>(RETRIEVAL_TIMEOUT_MS = 4 s)"]
  E -- "error / timeout" --> T3
  E --> F{"Any chunk ≥ workspace<br/>similarity floor?"}
  F -- "no · no_relevant_context" --> T3
  F -- "yes" --> GB{"Generation breaker open?"}
  GB -- "yes · tier1_circuit_open" --> T2
  GB -- "no" --> BUD{"Daily model-call<br/>budget left?"}
  BUD -- "no · tier1_budget_exhausted" --> T2
  BUD -- "yes" --> G["Gemini · JSON schema output<br/>(TIER1_TIMEOUT_MS = 8 s)"]
  G -- "error · tier1_model_error<br/>timeout · tier1_timeout" --> T2
  G --> V1{"Valid JSON?"}
  V1 -- "no · tier1_invalid_output" --> T2
  V1 -- "yes" --> V2{"confidence ≥ threshold?"}
  V2 -- "no · tier1_low_confidence" --> T2
  V2 -- "yes" --> V3{"cites ≥ 1 passage, all<br/>ids ⊆ retrieved?"}
  V3 -- "no · tier1_no_citations /<br/>tier1_invalid_citation" --> T2
  V3 -- "yes" --> V4{"grounding ≥ TIER1_MIN_GROUNDING?<br/>(answer words found in citations)"}
  V4 -- "no · tier1_ungrounded" --> T2
  V4 -- "yes" --> T1(["Tier 1 · cited AI answer"])
  T2(["Tier 2 · top ≤ 3 excerpts verbatim"])
  T3{"FAQ whole-word<br/>keyword match?"} -- "yes" --> F3(["Tier 3 · FAQ answer"])
  T3 -- "no / DB error" --> H(["Tier 3 · human hand-off message"])

  T1 & T2 & F3 & H --> EV["emit answer.completed"]
  EV -. "audit write fails → logged only" .-> AUD[("answers table")]
```

**What "confident enough" means.** Tier 1 needs four independent checks to pass:

1. **Retrieval:** at least one passage clears the per-workspace similarity floor (default 0.6).
2. **Structure:** the output is schema-valid JSON `{ answer, citedChunkIds, confidence }`.
3. **Provenance:** every cited id was actually sent to the model.
4. **Calibration + grounding:** self-reported confidence clears the threshold, *and* enough of the answer's content words appear in the cited text.

Self-reported confidence is poorly calibrated, so it is never the only gate.

**Cost honesty.** Tokens spent on a Tier 1 attempt that was later rejected are still recorded, so the audit log reflects real spend.

### Circuit breaker states

There is one breaker per dependency, so an embedding outage and a chat-model outage trip independently.

```mermaid
stateDiagram-v2
  [*] --> Closed
  Closed --> Open: 5 consecutive failures
  Open --> HalfOpen: 30 s cool-down elapsed
  HalfOpen --> Closed: the single probe succeeds
  HalfOpen --> Open: the probe fails
  note right of HalfOpen
    Exactly one probe request is let through,
    concurrent requests are short-circuited.
  end note
```

---

## 7. Asking a question, end to end

```mermaid
sequenceDiagram
  autonumber
  actor U as Support agent
  participant C as Console (urql)
  participant A as NestJS API
  participant P as Postgres (RLS)
  participant G as Gemini
  participant L as AuditListener

  U->>C: types question in Playground
  C->>A: mutation askQuestion(query)
  A->>A: AuthGuard → RolesGuard(viewer) → AskLimiter
  A->>P: tenant tx: read ladder settings
  A->>G: embed(query) [4 s budget]
  G-->>A: 768-dim vector
  A->>P: tenant tx: match_chunks(ws, vec, k, public_only=false)
  P-->>A: top-k chunks + similarity
  Note over A: no DB transaction is held during the model call
  A->>G: generate(JSON schema, delimited passages) [8 s budget]
  G-->>A: { answer, citedChunkIds, confidence }
  A->>A: validate JSON · citations ⊆ retrieved · confidence · grounding
  A-->>C: AnswerOutcome { tier, answer, citations, trace }
  A--)L: event answer.completed
  L->>P: tenant tx: insert into answers (tokens, ids, trace, latency)
  C-->>U: tier badge + citations + decision trace
```

---

## 8. Ingestion pipeline

```mermaid
sequenceDiagram
  autonumber
  actor E as Editor
  participant C as Console
  participant A as API
  participant X as PDF worker thread
  participant Q as Redis / BullMQ
  participant W as Ingestion worker
  participant G as Gemini
  participant P as Postgres

  E->>C: drop file (PDF / TXT / MD ≤ 20 MB)
  C->>A: POST /documents/upload
  A->>A: ingest rate limit (per workspace / hour)
  opt PDF
    A->>X: parse (30 s limit · 512 MB heap · max 2 concurrent)
    X-->>A: extracted text
  end
  A->>P: insert document (status = pending)
  A->>Q: add job { documentId, workspaceId } — ids only
  alt Redis down
    A->>P: status = failed (Retry button in console)
  end
  Q->>W: deliver job
  W->>P: withWorkspace: load text
  W->>W: chunk 1,200 chars / 200 overlap, word-aligned
  loop batches
    W->>G: embed(batch)
    W--)Q: progress %
    Q--)A: QueueEvents
    A--)C: subscription ingestionProgress
  end
  W->>P: upsert chunks by "documentId:chunkIndex" + delete stale tail
  W->>P: status = ready
  Note over W: failures retry with backoff, UnrecoverableError → failed
```

**Idempotency.** Chunk ids are deterministic (`${documentId}:${chunkIndex}`), so a retried job overwrites rather than duplicates. Stale tail chunks from a shorter re-ingest are deleted in the same transaction.

**Retention sweep.** Every six hours the worker calls `run_retention()`. It deletes answer-audit rows older than `ANSWER_RETENTION_DAYS` (default 90), plus expired invitations, refresh tokens and API tokens.

---

## 9. Data model

```mermaid
erDiagram
  USERS ||--o{ WORKSPACE_MEMBERS : "belongs to"
  WORKSPACES ||--o{ WORKSPACE_MEMBERS : has
  WORKSPACES ||--o{ DOCUMENTS : owns
  DOCUMENTS ||--o{ CHUNKS : "split into"
  WORKSPACES ||--o{ FAQS : owns
  WORKSPACES ||--o{ ANSWERS : audits
  WORKSPACES ||--o| WIDGET_CONFIGS : themes
  WORKSPACES ||--o{ WORKSPACE_INVITATIONS : issues
  USERS ||--o{ REFRESH_TOKENS : "sessions"
  USERS ||--o{ API_TOKENS : "MCP PATs"

  WORKSPACES {
    uuid id PK
    text name
    text plan
    text widget_key "single source of truth"
    float confidence_threshold
    float similarity_floor
  }
  WORKSPACE_MEMBERS {
    uuid workspace_id FK
    uuid user_id FK
    text role "owner|admin|editor|viewer"
  }
  USERS {
    uuid id PK
    text email
    text password_hash "scrypt, not readable by app role"
    text google_sub
  }
  DOCUMENTS {
    uuid id PK
    uuid workspace_id FK
    text status "pending|processing|ready|failed"
    text source_type
    text visibility "internal|public"
    text content
    text storage_key
  }
  CHUNKS {
    text id PK "documentId:chunkIndex"
    uuid workspace_id FK
    uuid document_id FK
    vector embedding "768 dims, HNSW"
    text embedding_model
    text content
  }
  FAQS {
    uuid id PK
    uuid workspace_id FK
    text question
    text answer
    text_array keywords "normalized"
    text visibility "internal|public"
  }
  ANSWERS {
    uuid id PK
    uuid workspace_id FK
    text tier
    text channel "console|widget|mcp"
    text model
    int tokens_in
    int tokens_out
    text_array retrieved_chunk_ids
    text_array cited_chunk_ids
    float confidence
    float top_similarity
    text decision_note
    jsonb decision_trace
    int latency_ms
  }
  WIDGET_CONFIGS {
    uuid workspace_id FK
    jsonb theme
    timestamptz rotated_at
  }
  WORKSPACE_INVITATIONS {
    uuid id PK
    uuid workspace_id FK
    text token_hash "SHA-256"
    text role
    timestamptz expires_at "7 days, single use"
  }
  REFRESH_TOKENS {
    text token_hash "SHA-256"
    uuid family_id
    timestamptz used_at
    timestamptz revoked_at
  }
  API_TOKENS {
    text token_hash "SHA-256"
    text name
    timestamptz last_used_at
    timestamptz expires_at
    timestamptz revoked_at
  }
```

**Vector search.** `match_chunks(workspace_id, query_embedding, top_k, public_only)` runs server-side:

- It filters by `workspace_id` inside the SQL, on top of RLS.
- It uses an HNSW index with `hnsw.iterative_scan = relaxed_order`. IVFFlat would post-filter, so small tenants would get fewer than k rows.
- If the iterative scan still comes back short, it falls back to an exact search for that tenant only, which is cheap for small tenants.

Migrations are plain, forward-only SQL files (`0001_init` → `0004_hardening`), applied by a ~60-line runner under an advisory lock.

---

## 10. Tenant isolation

Isolation is enforced in Postgres, in layers, so that no single application bug can cross tenants.

```mermaid
flowchart TB
  L1["① Request context<br/>AuthGuard puts workspaceId in AsyncLocalStorage<br/>(no workspace → DbService throws: fail closed)"]
  L2["② Unit of work<br/>one short transaction · set_config('app.workspace_id', id, true)<br/>transaction-local, can't leak to the next pooled request"]
  L3["③ Database role<br/>omniio_app: not owner · not superuser · NOBYPASSRLS<br/>column grants hide users.password_hash"]
  L4["④ RLS policy on every tenant table<br/>USING / WITH CHECK (workspace_id = nullif(current_setting(...), '')::uuid)"]
  L5["⑤ Narrow SECURITY DEFINER functions<br/>auth_find_user · user_workspaces · workspace_role · resolve_widget_key<br/>invitation_preview · accept_invitation · run_retention (pinned search_path)"]
  L6["⑥ Proof<br/>e2e tests as omniio_app: no-WHERE selects, cross-tenant insert/update/delete,<br/>vector search aimed at another tenant"]
  L1 --> L2 --> L3 --> L4
  L4 -.-> L5
  L4 -.-> L6
```

**Why `nullif(…, '')`?** After a transaction-local `set_config`, a pooled connection reads the setting back as `''`, not `NULL`, and `''::uuid` raises an error on every later unscoped query.

**Why no transaction across model calls?** A slow LLM would pin pool connections. Each unit of work holds a connection for milliseconds.

---

## 11. Authentication and sessions

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (tab)
  participant A as API /auth
  participant P as Postgres

  B->>A: POST /auth/login (email, password)
  A->>P: auth_find_user() — SECURITY DEFINER
  A->>A: scrypt verify
  A->>P: insert refresh token (SHA-256, new family)
  A-->>B: access JWT (15 min, memory only) + httpOnly SameSite=Strict cookie (path /auth)
  Note over B: access token expires
  B->>B: Web Lock: one refresh across all tabs
  B->>A: POST /auth/refresh (cookie)
  A->>P: mark old token used · insert next token (same family)
  A-->>B: new access JWT + rotated cookie
  alt an already-used token is presented (theft)
    A->>P: revoke the whole family
    A-->>B: 401 — every session in that family is signed out
  end
```

| Concern | Decision |
| --- | --- |
| Access token | 15-minute JWT with `typ: "access"`, held in memory only |
| Refresh token | Opaque, SHA-256 at rest, rotated on every use, reuse revokes the whole family |
| Google sign-in | Authorization code + PKCE + state cookie. **Never** auto-linked to an existing password account by email, because sign-up doesn't verify email ownership |
| Invitations | Single-use links valid for 7 days, bound to possession of the link. With `ALLOW_SIGNUP=false` they are the only way to create an account |
| Roles | `owner > admin > editor > viewer`. Nobody can grant above their own role, only owners can modify owners, and there is always ≥ 1 owner |
| Production boot guard | The API refuses to start with `COOKIE_SECURE=false` or the example `JWT_SECRET` |

---

## 12. Public widget

```mermaid
sequenceDiagram
  autonumber
  actor V as Visitor
  participant S as Customer site
  participant J as widget.js (Shadow DOM)
  participant A as API /w/:key
  participant R as Redis
  participant P as Postgres

  S->>J: <script src=".../widget.js" data-omniio-key=KEY>
  J->>A: GET /w/KEY/config
  A->>P: resolve_widget_key(KEY)
  alt key unknown or rotated
    A-->>J: 404 → widget stays hidden
  else Postgres down
    A-->>J: default theme
  end
  V->>J: asks a question
  J->>A: POST /w/KEY/ask (CORS *, no credentials)
  A->>R: rate limit per IP + per workspace
  A->>A: ladder with public_only = true · no trace returned
  A-->>J: { tier, answer, citations }
```

- **Isolation from the host page:** the widget renders in a Shadow DOM, ships as a separate ~72 kB gzipped IIFE bundle, and is ASCII-only so it works on pages without a UTF-8 charset.
- **Data exposure:** it answers only from public documents and FAQs. Both are internal by default, so Tier 2 and Tier 3 can't leak internal content to anonymous visitors.
- **Key rotation:** takes effect immediately and doesn't affect console sessions.

---

## 13. MCP server for AI assistants

```mermaid
sequenceDiagram
  autonumber
  participant M as MCP client
  participant A as POST /mcp
  participant T as McpToolsService
  participant P as Postgres

  M->>A: JSON-RPC tools/call + Bearer omni_pat_…
  A->>A: AuthGuard (PAT accepted only on /mcp) → user
  A->>T: new stateless McpServer bound to user
  T->>P: workspace_role(workspaceId, userId)
  alt not a member
    T-->>M: isError: "You are not a member of that workspace."
  else member
    T->>P: withWorkspace(workspaceId) — same RLS scope as the console
    T-->>M: JSON result
  end
```

| Tool | Input | Effect |
| --- | --- | --- |
| `list_workspaces` | — | Read-only: the caller's memberships and roles |
| `list_documents` | `workspaceId` | Read-only: documents with ingestion status |
| `list_faqs` | `workspaceId` | Read-only: Tier 3 FAQ entries |
| `ask_question` | `workspaceId`, `query` (≤ 1,000 chars) | Runs the ladder. It calls Gemini, writes an audit row and is rate-limited per user |

Every tool declares a title, an input schema and all four MCP annotation hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), so clients can warn before a tool with side effects runs.

The transport is Streamable HTTP in stateless mode (HTTP+SSE is deprecated in the MCP spec), so there are no sessions to store or scale. OAuth 2.1 is on the roadmap.

---

## 14. Deployment topology

The reference deployment is one server running Docker Compose. The same images run unchanged on container platforms.

```mermaid
flowchart TB
  NET(("Internet")) -- ":80 / :443 (HTTP/3)" --> WEB

  subgraph Host["Single Linux host · docker compose (project: omniio)"]
    WEB["web · Caddy<br/>auto-HTTPS · HSTS · nosniff<br/>console + widget static files"]
    API["api · node dist/main.js :3000<br/>healthcheck /health"]
    WRK["worker · node dist/worker.js"]
    MIG["migrate · node dist/migrate.js<br/>(runs once, then exits)"]
    PG[("postgres · pgvector/pgvector:pg16<br/>volume pgdata")]
    RD[("redis:7-alpine · AOF<br/>volume redisdata")]
  end

  WEB -- "reverse_proxy" --> API
  MIG -- "owner role (DATABASE_MIGRATOR_URL)" --> PG
  API -- "omniio_app" --> PG
  WRK -- "omniio_app" --> PG
  API --> RD
  WRK --> RD
  API & WRK -- "HTTPS" --> GEM["Gemini API"]

  PG -. "healthy" .-> MIG
  MIG -. "completed successfully" .-> API & WRK
  API -. "healthy" .-> WEB
```

**Start-up order:** Postgres becomes healthy → `migrate` runs as the schema owner and exits 0 → the API and worker start as `omniio_app` → Caddy starts once the API is healthy.

**Scaling path:**

| Component | Scales | Note |
| --- | --- | --- |
| API | Horizontally | Stateless apart from in-process circuit breakers |
| Worker | Horizontally | BullMQ distributes jobs; `concurrency: 2` per process |
| Postgres | Vertically + read replicas | Managed options need pgvector ≥ 0.8 for `hnsw.iterative_scan` |
| Redis | Managed instance | Holds only queues and counters, no source data |
| Console / widget | CDN | Same-site with the API, because the refresh cookie is `SameSite=Strict` |

---

## 15. Failure matrix

| Dependency fails | Detection | Customer gets | Recorded as |
| --- | --- | --- | --- |
| Gemini chat model errors | exception | Tier 2 excerpts | `tier1_model_error` |
| Gemini chat model hangs | 8 s `AbortSignal` | Tier 2 excerpts | `tier1_timeout` |
| Repeated model failures | breaker open | Tier 2, no model call | `tier1_circuit_open` |
| Model returns bad JSON | schema parse | Tier 2 | `tier1_invalid_output` |
| Model invents a citation | ids ⊄ retrieved | Tier 2 | `tier1_invalid_citation` |
| Answer not supported by its citations | grounding ratio | Tier 2 | `tier1_ungrounded` |
| Daily budget spent | Redis counter | Tier 2 | `tier1_budget_exhausted` |
| Embedding API down or slow | exception / 4 s budget / breaker | Tier 3 FAQ or hand-off | `retrieval_failed` / `retrieval_timeout` / `retrieval_circuit_open` |
| Nothing relevant indexed | similarity floor | Tier 3 | `no_relevant_context` |
| Audit write fails | listener catch | Same answer | logged only |
| Redis down | client error | Same answers; per-process rate limits; uploads saved as `failed` + Retry | `/health` → `degraded` |
| Postgres down | client error | Widget: hand-off message + default theme | `/health` → 503 |
| PDF bomb or slow parse | worker-thread limits | Upload rejected; API stays responsive | document `error` |

---

## 16. Technology stack and decisions

| Layer | Stack |
| --- | --- |
| API | NestJS 12, GraphQL (Apollo 5, code-first), REST, MCP SDK, zod, class-validator |
| Data | PostgreSQL 16, pgvector 0.8 (HNSW + iterative scan), RLS, plain SQL migrations |
| Jobs | BullMQ 6 on Redis 7, separate worker process |
| AI | Gemini `gemini-3.5-flash` + `gemini-embedding-2` (768 dims) behind an `AiProvider` interface, plus a deterministic fake with failure injection |
| Console | React 19, Vite 8, React Router 7, Tailwind v4, shadcn/ui, urql, graphql-ws |
| Widget | Standalone React IIFE bundle in a Shadow DOM |
| Delivery | Docker (Node 24 LTS), Caddy, GitHub Actions (typecheck, unit, RLS e2e on real pgvector, image builds), Dependabot |

| ADR | Decision |
| --- | --- |
| [0001](https://github.com/JawadulHadi/omni-io/blob/main/docs/adr/0001-tenant-isolation-in-postgres.md) | Tenant isolation in Postgres, not application code |
| [0002](https://github.com/JawadulHadi/omni-io/blob/main/docs/adr/0002-short-tenant-transactions.md) | One short tenant transaction per unit of work |
| [0003](https://github.com/JawadulHadi/omni-io/blob/main/docs/adr/0003-plain-sql-migrations.md) | Plain SQL migrations instead of an ORM |
| [0004](https://github.com/JawadulHadi/omni-io/blob/main/docs/adr/0004-sync-answers-queued-ingestion.md) | Synchronous answers, queued ingestion |
| [0005](https://github.com/JawadulHadi/omni-io/blob/main/docs/adr/0005-model-output-is-untrusted.md) | Model output is untrusted input |
| [0006](https://github.com/JawadulHadi/omni-io/blob/main/docs/adr/0006-rotating-refresh-tokens.md) | Rotating refresh tokens with reuse detection |
| [0007](https://github.com/JawadulHadi/omni-io/blob/main/docs/adr/0007-urql-and-a-separate-widget-bundle.md) | urql and a separate widget bundle |
| [0008](https://github.com/JawadulHadi/omni-io/blob/main/docs/adr/0008-mcp-streamable-http.md) | MCP over Streamable HTTP, stateless, under the caller's scope |

---

*Source code, ADRs and full documentation: [github.com/JawadulHadi/omni-io](https://github.com/JawadulHadi/omni-io).*
