# Getting started

You need **Node 24 LTS** and **Docker**. The app runs on Node 22.12+, but the unit tests need 24.9+.

```sh
git clone https://github.com/JawadulHadi/omni-io.git && cd omni-io

cd backend
cp .env.example .env               # AI_PROVIDER=fake: no API key needed
docker compose up -d --wait        # Postgres 16 + pgvector, Redis 7, the omniio_app role
npm ci
npm run migrate                    # as the schema owner
npm run seed                       # demo@omniio.dev / demo-password-123
npm run start:dev                  # API    → http://localhost:3000/graphql
npm run worker:dev                 # worker (second terminal)

cd ../frontend
npm ci && npm run dev              # console → http://localhost:5173
```

## A five-minute tour

1. Sign in as `demo@omniio.dev` / `demo-password-123`.
2. **Documents:** upload the files in [`samples/`](https://github.com/JawadulHadi/omni-io/tree/main/samples) and watch the ingestion progress live.
3. **Playground:** ask one of the sample questions. You get a Tier 1 answer with verified citations and the full decision trace.
4. Force a failure by adding a marker to the question. The answer drops to Tier 2 instead of failing:
   - `[fail:timeout]`
   - `[fail:json]`
   - `[fail:cite]`
   - `[fail:lowconf]`
   - `[fail:error]`
5. **Answer audit:** see the tier mix, the tokens used, and why each answer landed where it did.
6. **Widget:** copy the embed snippet into any HTML page.

## Real answers

Set `AI_PROVIDER=gemini` and `GEMINI_API_KEY` in `backend/.env`. Then set the similarity floor back to **0.6** under *Playground → Ladder settings*. The seed lowers it to 0.1 for the fake provider's bag-of-words vectors.

## Running the tests

```sh
cd backend
npm test            # unit tests: ladder branches, breakers, grounding, chunking, auth guard, prompt, MCP tools
npm run test:e2e    # against the real Postgres, as omniio_app: RLS, invitations, vector-search fallback, retention
cd ../frontend && npm run build
```
