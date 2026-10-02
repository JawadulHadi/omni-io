# MCP integration

Omni.io exposes its knowledge base to AI assistants over the Model Context Protocol, using Streamable HTTP in stateless mode.

## Connect a client

1. In the console, open **API tokens** and create a token. It is shown once and starts with `omni_pat_`.
2. Point the client at `https://<your-domain>/mcp` with `Authorization: Bearer omni_pat_…`.

For example, a client that takes a JSON config:

```json
{
  "mcpServers": {
    "omniio": {
      "type": "http",
      "url": "https://support.example.com/mcp",
      "headers": { "Authorization": "Bearer omni_pat_..." }
    }
  }
}
```

## Tools

| Tool | Input | Read-only | Notes |
| --- | --- | --- | --- |
| `list_workspaces` | — | ✅ | Your memberships and roles |
| `list_documents` | `workspaceId` | ✅ | Documents with ingestion status |
| `list_faqs` | `workspaceId` | ✅ | The Tier 3 FAQ floor |
| `ask_question` | `workspaceId`, `query` (≤ 1,000 chars) | ❌ | Runs the ladder, writes an audit row, spends the model budget, and is rate-limited per user |

A token acts as its user. Every call re-checks live membership, so removing someone from a workspace takes effect immediately. Revoke tokens in the console at any time. MCP OAuth 2.1 is on the [roadmap](Roadmap).
