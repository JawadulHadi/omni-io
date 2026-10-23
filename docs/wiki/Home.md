# Omni.io Wiki

**AI customer support that degrades gracefully instead of failing.** Omni.io is multi-tenant RAG on NestJS, PostgreSQL row-level security + pgvector, BullMQ, Gemini and React.

Every question gets an answer:

1. a cited AI answer, if it can be trusted;
2. otherwise the most relevant excerpts, verbatim;
3. otherwise a deterministic FAQ or a human hand-off.

Every answer records why it landed where it did. Tenants can't see each other's data, even through an application bug, because Postgres enforces the isolation.

## Start here

| If you want to… | Read |
| --- | --- |
| Run it locally in five minutes | [Getting started](Getting-Started) |
| Understand the design | [Architecture](Architecture) |
| See how failures degrade | [Resilience ladder](Resilience-Ladder) |
| Check the security model | [Multi-tenancy and security](Multi-Tenancy-and-Security) |
| Put it on a server | [Deployment](Deployment) |
| Connect Claude, Cursor or another AI assistant | [MCP integration](MCP-Integration) |
| Fix something that isn't working | [Troubleshooting](Troubleshooting) |
| See what's next | [Roadmap](Roadmap) |
| Cut a release | [Release process](Release-Process) |

## At a glance

| | |
| --- | --- |
| **Status** | v1.1.0, deployable with one command, not yet running in production |
| **Licence** | [MIT](https://github.com/JawadulHadi/omni-io/blob/main/LICENSE) |
| **Security** | Report privately, see [SECURITY.md](https://github.com/JawadulHadi/omni-io/blob/main/SECURITY.md) |
| **Contributing** | [CONTRIBUTING.md](https://github.com/JawadulHadi/omni-io/blob/main/CONTRIBUTING.md) · [Code of Conduct](https://github.com/JawadulHadi/omni-io/blob/main/CODE_OF_CONDUCT.md) |

The wiki is a map. The repository's [`docs/`](https://github.com/JawadulHadi/omni-io/tree/main/docs) folder is the source of truth: it is versioned with the code and reviewed in pull requests.
