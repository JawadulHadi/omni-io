# Architecture decision records

These are short records of the decisions that shape Omni.io, in the [Nygard format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions). A new decision gets the next number. A superseded record stays in place and is marked as superseded.

| # | Decision | Status |
| --- | --- | --- |
| 0001 | [Enforce tenant isolation in Postgres with a non-owner app role](0001-tenant-isolation-in-postgres.md) | Accepted |
| 0002 | [One short transaction per unit of work, never across a model call](0002-short-tenant-transactions.md) | Accepted |
| 0003 | [Plain SQL migrations instead of an ORM](0003-plain-sql-migrations.md) | Accepted |
| 0004 | [Synchronous answers under a time budget; queued ingestion](0004-sync-answers-queued-ingestion.md) | Accepted |
| 0005 | [Treat model output as untrusted input](0005-model-output-is-untrusted.md) | Accepted |
| 0006 | [Opaque rotating refresh tokens with reuse detection](0006-rotating-refresh-tokens.md) | Accepted |
| 0007 | [urql for the console; a separate Shadow-DOM bundle for the widget](0007-urql-and-a-separate-widget-bundle.md) | Accepted |
| 0008 | [MCP over Streamable HTTP, stateless, under the caller's scope](0008-mcp-streamable-http.md) | Accepted |
