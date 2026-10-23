# Deployment

## One server, one command

```sh
git clone https://github.com/JawadulHadi/omni-io.git && cd omni-io/deploy
cp .env.example .env     # DOMAIN, POSTGRES_PASSWORD, APP_DB_PASSWORD, JWT_SECRET, GEMINI_API_KEY
docker compose up -d --build
```

The stack is Postgres + pgvector, Redis, a migration job, the API, the worker, and Caddy with automatic HTTPS.

Start-up order: Postgres becomes healthy → migrations run → the API and worker start → Caddy starts.

## Before going live

- [ ] Deploy a **tagged release**, not `main`
- [ ] `ALLOW_SIGNUP=false`; onboard people with invite links
- [ ] A paid-tier Gemini key, with a low `TIER1_DAILY_LIMIT_PER_WORKSPACE` for public demos
- [ ] **Off-host Postgres backups** (`pg_dump` to object storage), with a tested restore
- [ ] An uptime monitor on `/health` and error tracking on the API and worker
- [ ] Only ports 80/443 open (plus SSH with keys only)

The phased go-live plan is in the [production-readiness review](https://github.com/JawadulHadi/omni-io/blob/main/docs/reviews/2026-10-02-production-readiness-review.md#5-path-to-production). Managed platforms, topology, the configuration checklist and operations are in [`docs/deployment.md`](https://github.com/JawadulHadi/omni-io/blob/main/docs/deployment.md).
