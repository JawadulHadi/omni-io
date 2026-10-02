#!/usr/bin/env bash
# Publishes docs/wiki/*.md to the GitHub wiki (a separate git repository).
# One-time setup: Settings → Features → Wikis on, then create any first page in the
# web UI so the wiki repository exists. After that, run this from anywhere:
#
#   docs/maintainers/publish-wiki.sh
set -euo pipefail

repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
wiki_url="${WIKI_URL:-https://github.com/JawadulHadi/omni-io.wiki.git}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone --quiet --depth 1 "$wiki_url" "$work"
# The repo's docs/wiki is the source of truth: pages removed there are removed here.
find "$work" -maxdepth 1 -name '*.md' -delete
cp "$repo_root"/docs/wiki/*.md "$work"/

cd "$work"
git add -A
if git diff --cached --quiet; then
  echo "Wiki already up to date."
  exit 0
fi
git commit --quiet -m "Sync wiki from $(git -C "$repo_root" rev-parse --short HEAD)"
git push --quiet origin HEAD
echo "Wiki published: ${wiki_url%.git}"
