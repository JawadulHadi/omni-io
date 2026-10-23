# Repository settings

Some project metadata lives in GitHub's settings rather than in files, so a pull request can't change it. This page is the source of truth for those settings. Apply them by hand, or with the `gh` commands below.

## About box

| Field | Value |
| --- | --- |
| **Description** | AI customer support that degrades gracefully instead of failing. Multi-tenant RAG on NestJS, PostgreSQL RLS + pgvector, BullMQ, Gemini and React: every answer cited, traced and tenant-isolated. |
| **Website** | The live demo URL once it exists. Until then, the architecture gist URL |
| **Topics** | `nestjs` `typescript` `postgresql` `pgvector` `row-level-security` `rag` `llm` `gemini` `bullmq` `redis` `graphql` `react` `multi-tenant` `mcp` `model-context-protocol` `ai-customer-support` `resilience` `circuit-breaker` `vector-search` `docker` |
| **Include in the home page** | ✅ Releases · ❌ Packages (until images are published to GHCR) · ❌ Deployments |

GitHub allows 20 topics, and this list uses all 20. They are chosen to match what recruiters and developers search for: the stack (NestJS, PostgreSQL, pgvector, GraphQL), the AI terms (RAG, LLM, MCP) and the design story (resilience, row-level security, multi-tenancy).

```sh
gh repo edit JawadulHadi/omni-io \
  --description "AI customer support that degrades gracefully instead of failing. Multi-tenant RAG on NestJS, PostgreSQL RLS + pgvector, BullMQ, Gemini and React: every answer cited, traced and tenant-isolated." \
  --add-topic nestjs,typescript,postgresql,pgvector,row-level-security,rag,llm,gemini,bullmq,redis \
  --add-topic graphql,react,multi-tenant,mcp,model-context-protocol,ai-customer-support,resilience,circuit-breaker,vector-search,docker \
  --enable-wiki
```

## Social preview

*Settings → General → Social preview*: upload a 1280 × 640 PNG of the wordmark (`docs/assets/wordmark-light.svg`) over the playground screenshot. This image is what link previews show on LinkedIn, Slack and X.

## Architecture gist

| Field | Value |
| --- | --- |
| **File name** | `omni-io-architecture.md`. A gist's title is its first file name, so keep this one |
| **Description** | Omni.io system architecture: a multi-tenant RAG support engine that degrades gracefully instead of failing. NestJS · PostgreSQL RLS + pgvector · BullMQ · Gemini · MCP. 14 Mermaid diagrams. |
| **Visibility** | Public |
| **Content** | Paste [`docs/gist/omni-io-architecture.md`](../gist/omni-io-architecture.md) as is. GitHub renders the Mermaid diagrams in gists |

After you create it, put the gist URL in the repository's **Website** field (until there is a live demo), the README header and the LinkedIn Featured section.

## Licence

The repository uses the [MIT licence](../../LICENSE), © 2026 Jawad Ul Hadi. GitHub detects it from `LICENSE` and shows "MIT license" in the About box, so there is nothing to configure.

## Security settings

*Settings → Code security and analysis*:

- [ ] **Private vulnerability reporting: on.** [SECURITY.md](../../SECURITY.md) tells reporters to use it.
- [ ] **Dependabot alerts and security updates: on.** Version updates are already configured in `.github/dependabot.yml`.
- [ ] **Secret scanning and push protection: on.**
- [ ] **Code scanning (CodeQL default setup): on.**

*Settings → Branches → add a rule for `main`*:

- [ ] Require a pull request before merging
- [ ] Require these status checks to pass:
  - `Backend · typecheck, unit tests, RLS integration`
  - `Frontend · typecheck, console and widget bundles`
  - `Production images build`
- [ ] Block force pushes and deletions

## Wiki

The wiki's pages live in [`docs/wiki/`](../wiki/), so they are reviewed in pull requests like any other docs.

1. Turn on *Settings → Features → Wikis*, and create any first page in the web UI. GitHub only creates the wiki repository after that first page.
2. Run [`docs/maintainers/publish-wiki.sh`](publish-wiki.sh). It replaces the wiki's pages with the contents of `docs/wiki/`.

Run it again after every merge that changes `docs/wiki/`.

## Releases

Follow [the release process](../wiki/Release-Process.md). For **v1.1.0**, after this pull request is merged:

```sh
git checkout main && git pull
git tag -a v1.1.0 -m "v1.1.0" && git push origin v1.1.0
gh release create v1.1.0 --title "v1.1.0 — Deployment hardening and security fixes" \
  --notes-file docs/releases/v1.1.0.md --latest
```

Without the `gh` CLI: *Releases → Draft a new release*, choose the tag `v1.1.0`, set the title above, paste [`docs/releases/v1.1.0.md`](../releases/v1.1.0.md), and tick **Set as the latest release**.
