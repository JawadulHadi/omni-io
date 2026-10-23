# API reference

Omni.io exposes three surfaces from one NestJS process:

- **GraphQL** at `/graphql` for the console. HTTP for queries and mutations; WebSocket (`graphql-ws`) for subscriptions.
- **REST** for things that need cookies, multipart or anonymous access.
- **MCP** at `/mcp` for AI assistants.

The full GraphQL schema is emitted to [`backend/schema.gql`](../backend/schema.gql) whenever the API boots in development.

## Authentication

- Send `Authorization: Bearer <accessToken>` on GraphQL, `/documents/upload` and `/mcp`.
- `/mcp` also accepts a personal access token (`Bearer omni_pat_…`), created under **API tokens** in the console. API tokens are refused on every other route.
- Access tokens are JWTs, valid for 15 minutes, with `typ: "access"`.
- Refresh tokens are opaque and live only in the httpOnly `omniio_rt` cookie (path `/auth`, `SameSite=Strict`). Each use rotates them. Presenting a rotated token again revokes the whole session family.
- GraphQL subscriptions send the token in `connectionParams.authorization`.

## REST

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /auth/providers` | public | `{ password: true, google: boolean, signup: boolean }` |
| `POST /auth/register` | public | `{ email, password (≥10), displayName, workspaceName?, inviteToken? }` → session. With `inviteToken`, the new user joins that workspace (and `workspaceName` isn't needed); otherwise they get their own workspace, which requires `ALLOW_SIGNUP=true` |
| `POST /auth/login` | public | `{ email, password, workspaceId?, inviteToken? }` → session. With `inviteToken`, the link is accepted and the session starts in that workspace |
| `POST /auth/refresh` | refresh cookie | Rotates the cookie → session |
| `POST /auth/switch-workspace` | refresh cookie | `{ workspaceId }` → session scoped to another workspace you belong to |
| `POST /auth/logout` | refresh cookie | Revokes the token family → `204` |
| `GET /auth/google?invite=…` → `/auth/google/callback` | public | Google OAuth (authorization code + PKCE). The optional `invite` survives the round trip. It never links to an existing password account with the same email: that redirects to `/login?error=google_exists`. Returns 404 when not configured |
| `POST /documents/upload` | editor+ | Multipart `file` (PDF/TXT/MD, ≤ 20 MB), plus optional `title` and `visibility` (`internal` \| `public`) |
| `GET /w/:key/config` | public (widget key) | Widget theme |
| `POST /w/:key/ask` | public (widget key) | `{ query }` (≤ 1,000 chars) → `{ tier, answer, citations: [{ documentTitle, snippet }] }` |
| `POST /mcp` | bearer | MCP JSON-RPC (Streamable HTTP, stateless) |
| `GET /health` | public | `{ status: "ok" \| "degraded" \| "down", checks: { database, redis } }`. 503 only when Postgres is down |

A session response is `{ accessToken, expiresIn, workspaceId, role, invitation? }`, plus a `Set-Cookie` for the refresh token. `invitation` is `accepted` or `invalid` when the request carried an `inviteToken`.

REST errors are `{ statusCode, message }`. Stack traces and internal messages are never returned.

## GraphQL

Every operation needs a valid access token. **Min role** is checked against the live membership row on each call.

| Operation | Type | Min role | Notes |
| --- | --- | --- | --- |
| `workspace` | query | viewer | The current workspace, including `widgetKey` and ladder settings |
| `myWorkspaces` | query | — | Every workspace you belong to |
| `createWorkspace(input)` | mutation | — | You become the owner; switch to it via `/auth/switch-workspace`. Capped by `MAX_WORKSPACES_PER_USER` |
| `updateLadderSettings(input)` | mutation | admin | `confidenceThreshold`, `similarityFloor` (0–1) |
| `members` | query | viewer | |
| `invitations` | query | admin | Pending (unused, unexpired) invite links |
| `createInvitation(input)` | mutation | admin | `{ role, label? }` → `{ token, invitation }`. Single-use, valid 7 days; the link is `/invite/<token>`. Can't grant above your own role |
| `revokeInvitation(id)` | mutation | admin | The link stops working immediately |
| `acceptInvitation(input)` | mutation | — | `{ token }` → the membership. An existing member keeps their role |
| `updateMemberRole(input)` | mutation | admin | Only owners can change owners; the last owner is protected |
| `removeMember(userId)` | mutation | admin | Same rules |
| `documents` | query | viewer | |
| `createDocumentFromText(input)` | mutation | editor | `title`, `content` (≤ 1M chars), `visibility` |
| `setDocumentVisibility(id, visibility)` | mutation | editor | |
| `retryIngestion(id)` | mutation | editor | Re-queues a failed document |
| `deleteDocument(id)` | mutation | admin | **GDPR erasure**: document, vectors, original file, audit references |
| `ingestionProgress` | subscription | viewer | `{ documentId, status, percent, chunkCount, error }` for your workspace. Membership is re-checked as events arrive, so a removed member stops receiving them |
| `faqs` / `createFaq` / `updateFaq` / `deleteFaq` | query / mutations | viewer / editor | Keywords are normalized on write. `visibility` (default `internal`): only `public` FAQs answer the widget |
| `askQuestion(query)` | mutation | viewer | Runs the ladder → `AnswerResult` with `tier`, `citations`, `trace`. Limited per user (`TOO_MANY_REQUESTS`) |
| `answers(filter)` | query | viewer | Audit log: filter by tier, channel or search; paginated; `tierCounts`, `totalTokens` |
| `widgetConfig` | query | viewer | Key, theme, rotation time, public-document count |
| `updateWidgetTheme(input)` | mutation | admin | |
| `rotateWidgetKey` | mutation | admin | The old key stops working immediately |
| `systemInfo` | query | viewer | Active AI provider and models |
| `apiTokens` / `createApiToken(input)` / `revokeApiToken(id)` | query / mutations | — | Your own MCP tokens. `createApiToken({ name, expiresInDays? })` returns the token once |

GraphQL errors carry `extensions.code`: `UNAUTHENTICATED`, `FORBIDDEN`, `BAD_USER_INPUT`, `NOT_FOUND`, `CONFLICT`, `TOO_MANY_REQUESTS` or `INTERNAL_SERVER_ERROR`.

```graphql
mutation Ask {
  askQuestion(query: "When are refunds issued?") {
    tier
    answer
    confidence
    citations { documentTitle snippet similarity }
    trace { step outcome detail ms }
  }
}
```

## MCP tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `list_workspaces` | — | Your memberships and roles |
| `list_documents` | `workspaceId` | Documents with ingestion status |
| `list_faqs` | `workspaceId` | The Tier 3 FAQ entries |
| `ask_question` | `workspaceId`, `query` | `{ tier, answer, confidence, citations }` |

Every call checks that you belong to `workspaceId`, then runs under that workspace's RLS scope. Answers are audited with `channel = mcp`, and `ask_question` shares the per-user question limit with the console.

```bash
curl -s http://localhost:3000/mcp \
  -H "Authorization: Bearer omni_pat_…" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_workspaces","arguments":{}}}'
```

## Rate limits

Counters are kept in Redis, so the limits hold across API instances. If Redis is unreachable, each instance counts on its own rather than blocking requests. A limited request gets HTTP `429` (GraphQL: `TOO_MANY_REQUESTS`).

| Surface | Limit (per minute) | Keyed by |
| --- | --- | --- |
| `/w/:key/*` | `WIDGET_LIMIT_PER_IP` (20) | Client IP (set `TRUST_PROXY` behind a load balancer) |
| `/w/:key/ask` | `WIDGET_LIMIT_PER_WORKSPACE` (300) | Widget key |
| `/auth/*` | `WIDGET_LIMIT_PER_IP` | Client IP |
| `askQuestion`, MCP `ask_question` | `ASK_LIMIT_PER_USER` (30) | User |
| Uploads, pastes, retries | `INGEST_LIMIT_PER_WORKSPACE` (60 per **hour**) | Workspace |
| Tier 1 model calls | `TIER1_DAILY_LIMIT_PER_WORKSPACE` (1,000 per **day**) | Workspace — over it, answers come from Tier 2 instead of failing |
