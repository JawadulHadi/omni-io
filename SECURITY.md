# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | ✅ |
| 0.2.x | ❌ (upgrade to 1.x) |
| 0.1.x | ❌ (known-broken scaffold, kept for history) |

## Reporting a vulnerability

**Please don't open a public issue.** Report privately through GitHub: **Security → Report a vulnerability** on [this repository](https://github.com/JawadulHadi/omni-io/security/advisories/new).

Please include the affected version or commit, reproduction steps, and the impact you expect. You'll get an acknowledgement within 3 business days and an assessment within 10. Fixes are released as patch versions and credited in the advisory unless you prefer otherwise.

## In scope

- Cross-tenant data access of any kind: RLS bypass, definer-function misuse, MCP scope escape.
- Authentication and session flaws: token confusion, refresh-token reuse not detected, role escalation.
- Prompt-injection paths that expose internal documents through the public widget, or that let a model answer escape citation validation.
- Secrets exposure (connector keys, password hashes, stack traces).

## Security model

- [docs/multi-tenancy.md](docs/multi-tenancy.md): row-level security, the `omniio_app` role, the unit-of-work transaction.
- [ADR 0006](docs/adr/0006-rotating-refresh-tokens.md): access and refresh tokens.
- [ADR 0005](docs/adr/0005-model-output-is-untrusted.md): how model output and retrieved content are handled.

## Known limitations

- `answers.query` stores customer-typed text. Deployments should set a retention policy.
- Erasure removes a document from the database, vectors, audit references and file storage. It cannot reach backups or the model provider's own retention.
- The widget key is public by design (it sits in page source). It only permits asking questions against documents marked public; rotate it if it's abused.
