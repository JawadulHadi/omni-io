# Contributing to Omni.io

Thanks for your interest. This guide covers local setup, the conventions the codebase follows, and what a good pull request looks like.

## Local setup

Requirements: Node 24 LTS (the unit tests need 24.9+; the app itself runs on 22.12+) and Docker.

```sh
cd backend
cp .env.example .env
docker compose up -d --wait        # Postgres 16 + pgvector, Redis 7, and the omniio_app role
npm ci && npm run migrate && npm run seed
npm run start:dev                  # API, watch mode
npm run worker:dev                 # ingestion worker, watch mode (second terminal)

cd ../frontend
npm ci && npm run dev              # console at http://localhost:5173
```

Sign in as `demo@omniio.dev` / `demo-password-123`, then upload the files in [`samples/`](samples/).

`AI_PROVIDER=fake` (the default) needs no API key. To force a failure mode, add `[fail:error]`, `[fail:timeout]`, `[fail:json]`, `[fail:lowconf]` or `[fail:cite]` to a question.

To reset the database: `docker compose down -v`, then `docker compose up -d --wait`, `npm run migrate` and `npm run seed`.

## Before you open a pull request

```sh
cd backend  && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build
```

CI runs the same checks. The RLS suite (`test:e2e`) needs the Docker database with migrations applied.

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/):
  - format: `feat(scope): …`, `fix(scope): …`, `docs: …`, `test: …`, `build: …`, `chore: …`
  - scopes: `db`, `auth`, `ai`, `answer`, `ingestion`, `api`, `console`, `widget`, `docs`
  - breaking changes: add `!` and a `BREAKING CHANGE:` footer
- **Branches:** `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
- **Database changes:**
  - Add a new numbered file in `backend/migrations/`. Never edit an applied migration.
  - A new tenant-owned table must follow the checklist in [docs/multi-tenancy.md](docs/multi-tenancy.md#checklist-adding-a-tenant-owned-table) and get a case in `test/rls.e2e-spec.ts`.
- **Data access** goes through `DbService`:
  - `tenant()` / `query()` for tenant tables.
  - `global()` only for non-tenant tables and the `SECURITY DEFINER` functions.
  - Never hold a tenant transaction across a model or embedding call.
- **The ladder never throws.** A new failure mode must degrade to the next tier, add a trace step and a `decision_note`, and get a unit test in `answer.service.spec.ts`.
- **Model output is untrusted.** Validate it before any field is used.
- **Style:** TypeScript strict mode. Match the surrounding code (formatting is described in `.editorconfig` and `.prettierrc.json`). Comments explain *why*, not *what*.
- **Architecture decisions:** add an ADR in [`docs/adr/`](docs/adr/) for anything a future reader would ask "why?" about.

## Pull request checklist

- [ ] Tests cover the change (unit, plus RLS integration if tenant data is touched)
- [ ] `CHANGELOG.md` updated under **Unreleased**
- [ ] Docs updated if behaviour, configuration or the API changed
- [ ] No secrets, `.env` files or personal data in the diff

## Reporting bugs and requesting features

Use the [issue templates](https://github.com/JawadulHadi/omni-io/issues/new/choose). **Security issues:** don't open an issue — see [SECURITY.md](SECURITY.md).

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
