#!/usr/bin/env bash
# Syncs Drizzle schema (schema.ts + re-exported schema.generated.ts) to
# $DATABASE_URL on every boot via `drizzle-kit push`. We use `push` rather
# than `migrate` because the hand-written SQL migrations in drizzle/ reference
# object tables (e.g. `member` in 0003_data_audit) that are defined only in
# the codegen'd schema and never made it into a CREATE TABLE migration. Push
# is idempotent and applies whatever the schema currently declares.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required for schema sync}"

# Apply idempotent hand-rolled SQL FIRST so drizzle-kit push sees the tables
# already exist and doesn't open an interactive prompt asking whether each
# new table is a rename of an existing one. drizzle-kit push --force does not
# suppress the rename-vs-create prompt on non-TTY stdin (it errors with
# "Interactive prompts require a TTY terminal"). Pre-creating with CREATE
# TABLE IF NOT EXISTS sidesteps the question entirely.
for SQL in drizzle/0004_proposals.sql drizzle/0005_notification.sql drizzle/0006_member_context_and_blockers.sql; do
  if [ -f "$SQL" ]; then
    echo "[entrypoint] applying $SQL..."
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$SQL"
  fi
done

# Regenerate codegen artifacts (schema.generated.ts and friends) from the
# bind-mounted ontology/ before drizzle-kit push. Container-baked generated
# files would otherwise be stale relative to any proposal previously applied
# via the API route, and `drizzle-kit push --force` would silently drop the
# applied columns to make the DB match the stale schema.
if [ -d ontology ] && [ -f scripts/regenerate-from-live.ts ]; then
  echo "[entrypoint] regenerating codegen from live ontology/..."
  npx --no-install tsx scripts/regenerate-from-live.ts || echo "[entrypoint] WARN: regenerate-from-live failed (non-fatal — using existing generated files)"
fi

echo "[entrypoint] syncing database schema..."

ATTEMPTS=0
MAX_ATTEMPTS=30
until npx --no-install drizzle-kit push --force; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    echo "[entrypoint] schema-sync retries exhausted after ${MAX_ATTEMPTS} attempts" >&2
    exit 1
  fi
  echo "[entrypoint] schema sync failed (attempt ${ATTEMPTS}/${MAX_ATTEMPTS}); retrying in 2s..."
  sleep 2
done

echo "[entrypoint] schema sync complete."

# Apply non-table migrations that drizzle-kit push doesn't handle:
# triggers, functions, grants. 0003_data_audit.sql is idempotent (uses
# CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER
# IF EXISTS) so it's safe to run on every boot.
if [ -f drizzle/0003_data_audit.sql ]; then
  echo "[entrypoint] applying data_audit triggers and functions..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f drizzle/0003_data_audit.sql
fi

echo "[entrypoint] startup complete; starting: $*"
exec "$@"
