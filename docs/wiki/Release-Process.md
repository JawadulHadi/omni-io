# Release process

Omni.io follows [Semantic Versioning](https://semver.org) and [Keep a Changelog](https://keepachangelog.com).

1. On a branch, move the entries under **Unreleased** in `CHANGELOG.md` to a new `## [x.y.z] - YYYY-MM-DD` section and update the compare links.
2. Bump `version` in `backend/package.json`, `frontend/package.json`, both lockfiles' root entries, and the MCP server version in `backend/src/modules/mcp/mcp.tools.ts`.
3. Write `docs/releases/vx.y.z.md`, starting with Security, then Highlights, Upgrading and Known limitations.
4. Merge the PR once CI is green.
5. Tag the merge commit on `main` and publish the release:

   ```sh
   git checkout main && git pull
   git tag -a vx.y.z -m "vx.y.z" && git push origin vx.y.z
   gh release create vx.y.z --title "vx.y.z" --notes-file docs/releases/vx.y.z.md --latest
   ```

   Without the `gh` CLI: *Releases → Draft a new release*, pick the tag, and paste the notes file.

6. If the release fixes a security issue, publish a GitHub security advisory and update the supported-versions table in `SECURITY.md`.
