# ADR 0006: Opaque rotating refresh tokens with reuse detection

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The scaffold signed refresh tokens with the same secret and payload as access tokens, so a 30-day refresh token worked as an access token. Nothing was ever rotated or revoked.

## Decision

- Access tokens are 15-minute JWTs with `typ: "access"`. `AuthGuard` rejects any other type.
- Refresh tokens are 32 random bytes, stored as SHA-256 hashes and grouped into one family per sign-in.
  - Each refresh atomically marks the presented token as used and issues a new one.
  - Presenting a token that was already used revokes the whole family.
- Refresh tokens are delivered only in an httpOnly, `SameSite=Strict` cookie scoped to `/auth`. The access token lives in memory.
- In the console, refreshes are single-flight within a tab and serialized across tabs with the Web Locks API. Otherwise two tabs racing on the same cookie would look like theft.

## Consequences

- A stolen refresh token is detectable, and the session can be killed. XSS can't read a long-lived credential.
- The console and API must be on the same site (see [deployment.md](../deployment.md)).
