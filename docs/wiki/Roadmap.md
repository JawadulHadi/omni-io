# Roadmap

## Path to production

These phases come from the [production-readiness review](https://github.com/JawadulHadi/omni-io/blob/main/docs/reviews/2026-10-02-production-readiness-review.md#5-path-to-production):

1. **Release hygiene:** tag v1.1.0, publish images to GHCR, add a CSP header.
2. **Infrastructure:** a VM, a domain, secrets, a paid-tier model key, nightly off-host backups with a tested restore.
3. **Observability:** an uptime monitor, error tracking, log shipping, a tier-mix dashboard.
4. **Go-live:** a public demo workspace and widget page, a load test with measured per-tier latency, a smoke test after each deploy.

## Product and platform

- Tier-mix and latency metrics (OpenTelemetry), with alerting on the fallback rate
- A Redis-backed circuit breaker shared across API instances
- A per-workspace evaluation set to tune thresholds from measured precision
- Email verification
- MCP OAuth 2.1
- GraphQL codegen for console types
- An S3/GCS driver for `BlobStorage`

Tracked in [CHANGELOG.md → Unreleased](https://github.com/JawadulHadi/omni-io/blob/main/CHANGELOG.md#unreleased).
