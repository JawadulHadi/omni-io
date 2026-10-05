# Deployment

## Quick start: one server with Docker Compose

On a fresh Ubuntu or Debian server, [`deploy/install.sh`](../deploy/install.sh) does everything below, including installing Docker and opening the host firewall. For a free server, follow [Free hosting on Oracle Cloud](deploy-oracle-free.md). Without a credit card, use [Render + Neon + Redis Cloud](deploy-render-free.md), which runs everything in one container from [`deploy/render.Dockerfile`](../deploy/render.Dockerfile).

[`deploy/`](../deploy/) runs the whole stack on a single Linux server: Postgres 16 with pgvector, Redis, the API, the ingestion worker, and Caddy. Caddy serves the console and the widget, proxies the API on the same origin, and gets the HTTPS certificate automatically.

1. Point a DNS record (for example `support.example.com`) at the server, and open ports 80 and 443.
2. Install Docker with the Compose plugin, then:

   ```sh
   git clone https://github.com/JawadulHadi/omni-io.git && cd omni-io/deploy
   cp .env.example .env
   # Fill in DOMAIN, the two database passwords, JWT_SECRET, and GEMINI_API_KEY (or AI_PROVIDER=fake).
   docker compose up -d --build
   ```

3. Open `https://<DOMAIN>`. With `ALLOW_SIGNUP=false` (the default in `deploy/.env.example`), create the first account by setting it to `true`, signing up, then setting it back to `false` and running `docker compose up -d`. Everyone else joins through invite links (Members → Invite someone).

Migrations run automatically, as the schema owner, before the API and worker start. Upgrading is `git pull && docker compose up -d --build`.

To try it on your own machine, set `DOMAIN=localhost`. Caddy then uses its own local certificate authority, so the browser warns once.

| Service      | Image                      | Notes                                                                                      |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------ |
| `postgres` | `pgvector/pgvector:pg16` | `deploy/initdb/` creates the `omniio_app` role from `APP_DB_PASSWORD` on first start |
| `redis`    | `redis:7-alpine`         | Append-only file on a volume                                                               |
| `migrate`  | `deploy/api.Dockerfile`  | `node dist/migrate.js`, then exits                                                       |
| `api`      | `deploy/api.Dockerfile`  | `node dist/main.js` on port 3000, inside the network only                                |
| `worker`   | `deploy/api.Dockerfile`  | `node dist/worker.js`                                                                    |
| `web`      | `deploy/web.Dockerfile`  | Caddy on 80 and 443                                                                        |

The two Dockerfiles also work unchanged on container platforms (Render, Railway, Fly.io, Cloud Run, ECS). Run the API, worker and migration from the same backend image with the three commands above. Provide Postgres with pgvector 0.8 or later and Redis 7 as managed services, and either run the web image or host `frontend/dist` on a CDN.

## Topology

| Component                                      | Runs                                                            | Scales                                                               |
| ---------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| API (`node dist/main.js`)                    | GraphQL, REST, widget, MCP                                      | Horizontally. Stateless apart from in-process circuit breakers       |
| Worker (`node dist/worker.js`)               | Chunking, embedding, the retention sweep                        | Horizontally. BullMQ distributes jobs;`concurrency: 2` per process |
| PostgreSQL ≥ 16 with**pgvector ≥ 0.8** | All data and vectors                                            | Vertically, plus read replicas if needed                             |
| Redis ≥ 7                                     | Queue, rate-limit counters, budgets, progress events            | —                                                                   |
| Static hosting                                 | `frontend/dist/` (console, hosted widget page, `widget.js`) | A CDN                                                                |

Each API instance runs its own BullMQ `QueueEvents` listener, so live ingestion progress reaches subscribers on any instance with no extra pub/sub.

Runtime: Node 22.12 or later (Nest 12 is ESM-only and is loaded through `require(esm)`). The images use Node 24 LTS, which the unit tests also need.

## Database

1. Create the database, an **owner** role for migrations, and the **app** role:

   ```sql
   create role omniio_app login password '<strong secret>' nosuperuser nobypassrls nocreatedb nocreaterole;
   ```

   The migration also creates `omniio_app` as `NOLOGIN` if it's missing. You then only need `alter role omniio_app login password '…'`.
2. Run migrations as the owner: `DATABASE_MIGRATOR_URL=postgres://owner:…@host/db node dist/migrate.js` (or `npm run migrate` from a checkout). Migrations are forward-only, and each file runs in its own transaction under an advisory lock.
3. Give the API and worker **only** `DATABASE_URL=postgres://omniio_app:…@host/db`.
4. Managed Postgres (RDS, Cloud SQL, Neon, Supabase): make sure pgvector is 0.8 or later (`select extversion from pg_extension where extname = 'vector'`). `match_chunks` relies on `hnsw.iterative_scan`.

## Configuration checklist

The API refuses to start in production with `COOKIE_SECURE=false` or the example `JWT_SECRET`.

- `NODE_ENV=production`. This disables GraphQL introspection and the playground, and keeps the schema in memory.
- `JWT_SECRET`: at least 32 characters. Use `openssl rand -base64 48`. Rotating it signs everyone out within 15 minutes; refresh tokens are unaffected.
- `COOKIE_SECURE=true`, and serve over HTTPS.
- `CONSOLE_ORIGIN`: the exact console origin or origins. It drives CORS and the Google OAuth redirect.
- `TRUST_PROXY`: the number of proxy hops. Without it, every visitor shares one IP for rate limiting.
- `ALLOW_SIGNUP`: `false` to allow new accounts only through invite links.
- `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and optionally the `GEMINI_*_MODEL` settings.
- Cost ceilings: `TIER1_DAILY_LIMIT_PER_WORKSPACE` (model calls per workspace per day; Tier 2 answers after that), `ASK_LIMIT_PER_USER`, `INGEST_LIMIT_PER_WORKSPACE`, `WIDGET_LIMIT_PER_IP`, `WIDGET_LIMIT_PER_WORKSPACE`, `MAX_WORKSPACES_PER_USER`.
- `ANSWER_RETENTION_DAYS` (default 90): how long customer questions stay in the audit. The worker enforces it every six hours.
- `STORAGE_DRIVER`: `none` (default) keeps only the extracted text, which is all ingestion needs. `local` also keeps original uploads in `STORAGE_DIR`. That directory must be **one volume shared by every API and worker process**: a delete that lands on a host without the file reports success without removing anything, so a GDPR erasure would leave the original behind.

## Hosting the frontend

The console and API must be on the **same site**, because the refresh cookie is `SameSite=Strict`. The simplest setup is one origin, as in [`deploy/Caddyfile`](../deploy/Caddyfile). With separate hosts (for example `console.example.com` and `api.example.com`), build with `VITE_API_BASE=https://api.example.com` and point Google's redirect URI at the API host.

On a single origin, the proxy needs these routes. The nginx equivalent of the Caddyfile:

```nginx
location ~ ^/(graphql|auth/|documents/upload|mcp|health) { proxy_pass http://api; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
location ~ ^/w/[0-9a-f]{32}/(ask|config)$ { proxy_pass http://api; }
location ~ ^/w/[0-9a-f]{32}/?$            { try_files /widget.html =404; }
location /                                { try_files $uri /index.html; }
```

`/auth/*` must reach the API. Google's callback (`/auth/google/callback`) and the refresh-cookie endpoints live there.

## The embeddable widget

```html
<script src="https://console.example.com/widget.js"
        data-omniio-key="WIDGET_KEY"
        data-api-base="https://api.example.com" async></script>
```

- It renders inside a Shadow DOM, so host-page CSS can't break it and its CSS can't leak out.
- The bundle is ASCII-only (a post-build step escapes everything else), so it renders correctly on pages that don't declare UTF-8.
- `/w/*` allows any origin without credentials. Every other route only allows `CONSOLE_ORIGIN`.
- If a bad key is present when the page loads, the widget stays hidden instead of showing visitors a broken chat.
- Widget visitors only ever see documents and FAQs marked **Public**.

## MCP clients

Create a personal access token under **API tokens** in the console, then point the client at `https://<DOMAIN>/mcp` (Streamable HTTP) with `Authorization: Bearer omni_pat_…`. A token acts as its user, with live membership checks on every tool call, and is refused everywhere except `/mcp`.

## Operations

- **Health:** `GET /health` returns `{ status, checks: { database, redis } }`. It returns 200 while Postgres answers, with `degraded` if Redis is down: every answer tier still works, but uploads can't be queued. It returns 503 only without Postgres. Point load-balancer checks at it.
- **Failure behaviour:**

  - **Redis down:** rate limits and budgets fall back to per-process counters, and uploads are saved as `failed` with a Retry button.
  - **Postgres down:** the widget answers with the hand-off message rather than an error.
  - **Embedding or model provider down:** the ladder degrades, behind timeouts and circuit breakers.
- **Watch the tier mix.** A rising share of Tier 2 or Tier 3 is the earliest sign of trouble:

  - a provider outage: `tier1_model_error`, `tier1_timeout`, `tier1_circuit_open`, `retrieval_timeout`, `retrieval_circuit_open`;
  - an exhausted budget: `tier1_budget_exhausted`;
  - a content gap: `no_relevant_context`.

  The audit page shows the distribution. Exporting it as metrics is on the [roadmap](../CHANGELOG.md).
- **Pool sizing:** each unit of work holds a connection for milliseconds, never for the length of a model call. The default pool of 20 per process is generous. A server-side `statement_timeout` (`DB_STATEMENT_TIMEOUT_MS`, default 30 s) frees connections held by abandoned queries.
- **Data retention:** the worker deletes answer-audit rows older than `ANSWER_RETENTION_DAYS`, along with expired invitations, refresh tokens and API tokens. GDPR erasure of a *document* is built in. Backups and the model provider's own retention are outside the transaction; document them in your DPA.
- **Backups:** back up the `pgdata` volume, or use your managed Postgres's snapshots. Redis only holds queues and counters.
