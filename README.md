# Omni.io

A multi-tenant AI customer-support engine. Every question walks down a **three-tier resilience ladder**: a cited AI answer, else verbatim excerpts, else a deterministic FAQ or a human hand-off. It always answers, never returns a 500, and records why it chose what it did.

> **0.2.0 is the hardened backend.** The admin console and embeddable widget ship in 1.0.0; `frontend/` is still the original scaffold.

## Quick start (backend)

Requires Node 20.16+ and Docker.

```sh
cd backend
cp .env.example .env            # AI_PROVIDER=fake needs no API key
docker compose up -d --wait     # postgres (pgvector) + redis; creates the omniio_app role
npm install
npm run migrate                 # applies migrations/*.sql as the schema owner
npm run seed                    # demo@omniio.dev / demo-password-123
npm run build
npm start                       # API → http://localhost:3000/graphql
npm run start:worker            # ingestion worker, a separate process
```

## How the ladder degrades

| What goes wrong | The customer gets | `decision_note` |
| --- | --- | --- |
| Nothing | **Tier 1**: model answer citing retrieved passages | `tier1_accepted` |
| Model errors, times out, or its circuit breaker is open | **Tier 2**: top ≤3 excerpts, verbatim | `tier1_model_error`, `tier1_timeout`, `tier1_circuit_open` |
| Invalid JSON, a citation of an unsent passage, or low confidence | Tier 2 | `tier1_invalid_output`, `tier1_invalid_citation`, `tier1_low_confidence` |
| Nothing above the similarity floor, or retrieval is down | **Tier 3**: FAQ keyword match, or a hand-off message | `no_relevant_context`, `retrieval_failed` |

With `AI_PROVIDER=fake`, put `[fail:error]`, `[fail:timeout]`, `[fail:json]`, `[fail:lowconf]` or `[fail:cite]` in a question to force each path.

## Tenant isolation

The app connects as `omniio_app` (not the owner, not a superuser, `NOBYPASSRLS`). Every unit of work is a short transaction that sets `app.workspace_id` transaction-locally, and it refuses to run without one. Pre-tenant lookups go through four narrow `SECURITY DEFINER` functions. `npm run test:e2e` proves the isolation against real Postgres.

## Tests

```sh
npm test            # unit: every ladder branch, circuit breaker, chunking, crypto, auth guard
npm run test:e2e    # RLS against the docker Postgres
```

See [CHANGELOG.md](CHANGELOG.md) for everything that changed since the 0.1.0 scaffold.
