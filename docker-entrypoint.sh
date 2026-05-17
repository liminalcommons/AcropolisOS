#!/usr/bin/env bash
# Syncs Drizzle schema (schema.ts + re-exported schema.generated.ts) to
# $DATABASE_URL on every boot via `drizzle-kit push`. We use `push` rather
# than `migrate` because the hand-written SQL migrations in drizzle/ reference
# object tables (e.g. `member` in 0003_data_audit) that are defined only in
# the codegen'd schema and never made it into a CREATE TABLE migration. Push
# is idempotent and applies whatever the schema currently declares.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required for schema sync}"

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

echo "[entrypoint] schema sync complete; starting: $*"
exec "$@"
