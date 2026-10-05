#!/usr/bin/env bash
# Publishes docs/wiki/*.md to the GitHub wiki (a separate git repository).
# One-time setup: Settings → Features → Wikis on, then create any first page in the
# web UI so the wiki repository exists. After that, run this from anywhere:
#
#   docs/maintainers/publish-wiki.sh
#
# Authentication: locally, your normal git credentials. In Actions, GITHUB_TOKEN
# (the job needs `permissions: contents: write`), or WIKI_TOKEN if you'd rather use
# a personal access token. The token travels as an HTTP header through git's
# environment config — never in the URL, the remote config or the process list.
set -euo pipefail

repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
wiki_url="${WIKI_URL:-https://github.com/JawadulHadi/omni-io.wiki.git}"
token="${WIKI_TOKEN:-${GITHUB_TOKEN:-}}"
work="$(mktemp -d)"
trap 'rm -rf "$work" "$work.err"' EXIT

if [[ -n "$token" ]]; then
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0="http.https://github.com/.extraheader"
  export GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$token" | base64 | tr -d '\n')"
fi

if ! git clone --quiet --depth 1 "$wiki_url" "$work" 2>"$work.err"; then
  cat "$work.err" >&2
  echo "Could not clone $wiki_url. Is the wiki enabled, with at least one page created in the web UI?" >&2
  exit 1
fi

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
