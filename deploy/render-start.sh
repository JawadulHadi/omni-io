#!/bin/sh
# Entry point of deploy/render.Dockerfile. Derives what a single-container host
# can't easily provide, runs migrations, then starts the API (with the worker
# in-process).
#
#   DATABASE_MIGRATOR_URL  the database owner's connection string (Neon: the direct one)
#   APP_DB_PASSWORD        any long random string: migrations give omniio_app this login
#   REDIS_URL, JWT_SECRET  as usual; GEMINI_API_KEY optional
set -eu

: "${DATABASE_MIGRATOR_URL:?set DATABASE_MIGRATOR_URL to the database owner connection string}"
: "${APP_DB_PASSWORD:?set APP_DB_PASSWORD to a long random string}"

# The app connects as omniio_app (row-level security applies to it), on the same host.
if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL=$(node -e '
    const url = new URL(process.env.DATABASE_MIGRATOR_URL);
    url.username = "omniio_app";
    url.password = process.env.APP_DB_PASSWORD;
    console.log(url.href);')
  export DATABASE_URL
fi

# Render provides the public URL; the console is served from it.
if [ -z "${CONSOLE_ORIGIN:-}" ] && [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export CONSOLE_ORIGIN="${RENDER_EXTERNAL_URL%/}"
fi
if [ -z "${GOOGLE_CALLBACK_URL:-}" ] && [ -n "${CONSOLE_ORIGIN:-}" ]; then
  export GOOGLE_CALLBACK_URL="${CONSOLE_ORIGIN%%,*}/auth/google/callback"
fi

# Real answers with a key, offline demo answers without one.
if [ -z "${AI_PROVIDER:-}" ]; then
  if [ -n "${GEMINI_API_KEY:-}" ]; then export AI_PROVIDER=gemini; else export AI_PROVIDER=fake; fi
fi

node dist/migrate.js
exec node dist/main.js
