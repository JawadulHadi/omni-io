# ADR 0008: MCP over Streamable HTTP, stateless, under the caller's scope

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The spec asked for an MCP server "over SSE", but the MCP specification has deprecated the HTTP+SSE transport in favour of Streamable HTTP. MCP must also never become a side door around tenant isolation.

## Decision

- `POST /mcp` uses the SDK's `StreamableHTTPServerTransport` in stateless mode, creating a fresh server per request.
- It authenticates with the same bearer JWT as the console, so the global `AuthGuard` applies.
- Every tool that takes a `workspaceId` first checks membership through `workspace_role()`, then runs inside `withWorkspace()`. RLS therefore scopes it exactly as it scopes the console.

## Consequences

- There are no sessions to store or scale.
- An assistant sees exactly what its user can see, and nothing more.
- MCP OAuth 2.1 authorization, for third-party clients without a console login, is future work.
