#!/bin/sh
# Runs once, on an empty data volume. The API and worker connect as omniio_app:
# not the owner, not a superuser, NOBYPASSRLS — so row-level security applies.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v app_password="$APP_DB_PASSWORD" <<'SQL'
create role omniio_app login password :'app_password' nosuperuser nobypassrls nocreatedb nocreaterole;
SQL
