# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.1.x | ✅ |
| 1.0.x | ❌ Upgrade to 1.1: it fixes a Google sign-in account takeover and an internal-FAQ exposure through the widget |
| 0.2.x | ❌ Upgrade to 1.1 |
| 0.1.x | ❌ Known-broken scaffold, kept for history |

Only the latest minor release gets security fixes.

## Reporting a vulnerability

**Please don't open a public issue.** Report privately through GitHub: **Security → Report a vulnerability** on [this repository](https://github.com/JawadulHadi/omni-io/security/advisories/new).

Please include the affected version or commit, reproduction steps, and the impact you expect. You'll get an acknowledgement within 3 business days and an assessment within 10. Fixes are released as patch versions and credited in the advisory unless you prefer otherwise.

## In scope

- Cross-tenant data access of any kind: RLS bypass, definer-function misuse, MCP scope escape.
- Authentication and session flaws: token confusion, refresh-token reuse not detected, role escalation.
- Prompt-injection paths that expose internal documents through the public widget, or that let a model answer escape citation validation.
- Secrets exposure (API tokens, invite links, password hashes, stack traces).
- MCP: a personal access token accepted outside `/mcp`, a tool acting outside the caller's membership, or tool annotations that understate side effects.
- Cost-ceiling bypass: ways to make model calls beyond the per-workspace daily budget or the per-user and per-IP limits.

## Out of scope

- Findings that need an already-compromised server, database superuser or host shell.
- Rate-limit tuning on a self-hosted deployment (all limits are configurable).
- Missing hardening headers on deployments that don't use the provided Caddyfile.
- Automated scanner output without a demonstrated impact.

## Security model

- [docs/multi-tenancy.md](docs/multi-tenancy.md): row-level security, the `omniio_app` role, the unit-of-work transaction.
- [ADR 0006](docs/adr/0006-rotating-refresh-tokens.md): access and refresh tokens.
- [ADR 0005](docs/adr/0005-model-output-is-untrusted.md): how model output and retrieved content are handled.
- [ADR 0008](docs/adr/0008-mcp-streamable-http.md): MCP authentication and scope.

## Deployment hardening checklist

Self-hosters should:

- Run the API and worker as `omniio_app` (`NOBYPASSRLS`), never as the migration owner or a superuser.
- Set `NODE_ENV=production`, `COOKIE_SECURE=true`, a random `JWT_SECRET` of at least 32 characters, and the correct `TRUST_PROXY`.
- Keep `ALLOW_SIGNUP=false` until email verification ships; onboard people with invite links.
- Use a paid-tier model API key, so customer content isn't used for training, and record that in your DPA.
- Back up Postgres off-host and test a restore.
- Expose only ports 80 and 443. Postgres and Redis stay on the internal Docker network.

The full list is in [docs/deployment.md](docs/deployment.md#configuration-checklist).

## Known limitations

- `answers.query` stores customer-typed text. Deployments should set a retention policy.
- Erasure removes a document from the database, vectors, audit references and file storage. It cannot reach backups or the model provider's own retention.
- There is no email verification yet, so an email address on an account is not proof of ownership. Google sign-in therefore never links to an existing account by email.
- Circuit breakers and in-process rate-limit fallbacks are per API instance.
- The widget key is public by design (it sits in page source). It only permits asking questions against documents marked public; rotate it if it's abused.
