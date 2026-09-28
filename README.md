# Omni.io — NestJS/React Scaffold

This is a working-structure scaffold generated from the architecture spec
("Omni.io — Backend & Frontend Architecture Spec"). It implements the real
shape of the system — modules, RLS-based tenant isolation, the 3-tier
resilience ladder, BullMQ ingestion — with runnable NestJS code and stubbed
integrations (LLM provider, embeddings) left as clearly marked TODOs so you
plug in real API keys rather than inheriting someone else's assumptions.

## What's real vs. stubbed

**Real, working code:**
- NestJS module structure and dependency wiring
- `TenantInterceptor` + Postgres RLS session-variable pattern
- Drizzle schema + migration with row-level security policies
- The resilience-ladder `AnswerService` (tier fallback logic, fully implemented)
- BullMQ ingestion producer/consumer wiring, chunking logic
- AES-256-GCM connector-key encryption helper
- GraphQL module skeleton with resolvers wired to services
- React/Vite frontend shell: console shell, playground page showing the tier badge, widget page

**Stubbed (marked `// TODO`) — needs your keys/config:**
- Actual embedding + chat-completion calls (`ai.service.ts`) — swap in OpenAI/Anthropic/etc.
- OAuth provider config for Google login
- MCP server transport wiring (the tool handlers are real; the SSE transport bootstrap is a stub)

## Quick start

```sh
cd backend
cp .env.example .env        # fill in DATABASE_URL, REDIS_URL, LLM_API_KEY, APP_USER_CONNECTION_KEY_SECRET
docker compose up -d        # postgres + redis
npm install
npm run migrate             # applies drizzle/migrations, including RLS policies
npm run start:dev           # API on :3000, GraphQL playground at /graphql

cd ../frontend
npm install
npm run dev                 # console on :5173
```

## Where to look first

- `backend/src/modules/answer/answer.service.ts` — the resilience ladder, the core of the product
- `backend/drizzle/migrations/0001_init.sql` — schema + RLS policies
- `backend/src/common/interceptors/tenant.interceptor.ts` — how workspace isolation is enforced
- `frontend/src/console/routes/playground.tsx` — where the ladder's tier badge shows up in the UI
