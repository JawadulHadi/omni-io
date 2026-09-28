# Deployment

## Topology

| Component | Runs | Scales |
| --- | --- | --- |
| API (`node dist/main.js`) | GraphQL, REST, widget, MCP | Horizontally. Stateless apart from an in-process circuit breaker |
| Worker (`node dist/worker.js`) | Chunking and embedding | Horizontally. BullMQ distributes jobs; `concurrency: 2` per process |
| PostgreSQL ≥ 16 with **pgvector ≥ 0.8** | All data and vectors | Vertically, plus read replicas if needed |
| Redis ≥ 7 | Queue, rate-limit counters, progress events | — |
| Static hosting | `frontend/dist/` (console, hosted widget page, `widget.js`) | A CDN |

Each API instance runs its own BullMQ `QueueEvents` listener, so live ingestion progress reaches subscribers on any instance with no extra pub/sub.

## Database

1. Create the database and an **owner** role for migrations, plus the **app** role:

   ```sql
   create role omniio_app login password '<strong secret>' nosuperuser nobypassrls nocreatedb nocreaterole;
   ```

   The migration also creates `omniio_app` as `NOLOGIN` if it's missing. You then only need `alter role omniio_app login password '…'`.
2. Run migrations as the owner: `DATABASE_MIGRATOR_URL=postgres://owner:…@host/db npm run migrate`. Migrations are forward-only, and each file runs in its own transaction under an advisory lock.
3. Give the API and worker **only** `DATABASE_URL=postgres://omniio_app:…@host/db`.
4. Managed Postgres (RDS, Cloud SQL, Neon, Supabase): make sure pgvector is ≥ 0.8 (`select extversion from pg_extension where extname = 'vector'`). `match_chunks` relies on `hnsw.iterative_scan`.

## Configuration checklist

- `NODE_ENV=production`. This disables GraphQL introspection and the playground, and keeps the schema in memory.
- `JWT_SECRET`: 48+ random bytes. Rotating it signs everyone out within 15 minutes; refresh tokens are unaffected.
- `COOKIE_SECURE=true`, and serve over HTTPS.
- `CONSOLE_ORIGIN`: the exact console origin(s). It drives CORS and the Google OAuth redirect.
- `TRUST_PROXY`: the number of proxy hops. Without it, every visitor shares one IP for rate limiting.
- `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and optionally the `GEMINI_*_MODEL` settings.
- `APP_USER_CONNECTION_KEY_SECRET`: 32 random bytes, base64 (`openssl rand -base64 32`).
- `STORAGE_DIR` on a persistent volume. Or implement `BlobStorage` for S3/GCS — one class, two methods.

## Hosting the frontend

The console and API must be on the **same site** (for example `console.example.com` and `api.example.com`), because the refresh cookie is `SameSite=Strict`. Build with `VITE_API_BASE=https://api.example.com`.

Route `/w/<key>` page loads to `widget.html`, and send `/w/<key>/ask` and `/w/<key>/config` to the API:

```nginx
location ~ ^/w/[0-9a-f]{32}/(ask|config)$ { proxy_pass http://api; }
location ~ ^/w/[0-9a-f]{32}/?$            { try_files /widget.html =404; }
location /                                { try_files $uri /index.html; }
```

## The embeddable widget

```html
<script src="https://console.example.com/widget.js"
        data-omniio-key="WIDGET_KEY"
        data-api-base="https://api.example.com" async></script>
```

- It renders inside a Shadow DOM, so host-page CSS can't break it and its CSS can't leak out.
- The bundle is ASCII-only, so it renders correctly on pages that don't declare UTF-8.
- `/w/*` allows any origin without credentials. Every other route only allows `CONSOLE_ORIGIN`.
- If a bad key is present when the page loads, the widget stays hidden instead of showing visitors a broken chat.

## Operations

- **Health:** `GET /health` does a database round-trip.
- **Watch the tier mix.** A rising share of Tier 2 or Tier 3 is the earliest sign of a provider outage (`tier1_model_error`, `tier1_timeout`, `tier1_circuit_open`) or a content gap (`no_relevant_context`). The audit page shows the distribution. Exporting it as metrics is on the [roadmap](../CHANGELOG.md).
- **Pool sizing:** each unit of work holds a connection for milliseconds, never for the length of a model call. The default pool of 20 per process is generous.
- **Data retention:** `answers.query` stores what customers typed. Set a retention policy (for example, a nightly delete of rows older than N days) to match your privacy commitments. GDPR erasure of a *document* is built in. Backups and the model provider's own retention are outside the transaction; document them in your DPA.
