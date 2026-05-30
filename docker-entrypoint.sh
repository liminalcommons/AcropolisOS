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
for SQL in drizzle/0004_proposals.sql drizzle/0005_notification.sql drizzle/0006_member_context_and_blockers.sql drizzle/0007_raw_inbox.sql drizzle/0008_approved_views.sql; do
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
until PUSH_OUT=$(npx --no-install drizzle-kit push --force 2>&1); PUSH_RC=$?; echo "$PUSH_OUT"; [ $PUSH_RC -eq 0 ]; do
  # If drizzle-kit exited non-zero it might be a transient DB-not-ready error
  # (e.g. the Postgres container hasn't accepted connections yet). Keep
  # retrying up to MAX_ATTEMPTS. But if the output contains a schema-level
  # error we cannot recover from by waiting, bail immediately.
  #
  # Case-insensitive grep: drizzle-kit emits "Error:" (capital E) on exit 0
  # in some versions; match both "ERROR:" and "Error:" to avoid missing it.
  if echo "$PUSH_OUT" | grep -Eiq "PostgresError|column .* contains null|relation .* does not exist|violates not-null|ERROR:|^Error:"; then
    echo "[entrypoint] FATAL: schema sync failed with a schema-level error (rc=$PUSH_RC) — will not retry:" >&2
    echo "$PUSH_OUT" >&2
    exit 1
  fi
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    echo "[entrypoint] schema-sync retries exhausted after ${MAX_ATTEMPTS} attempts" >&2
    exit 1
  fi
  echo "[entrypoint] schema sync failed (attempt ${ATTEMPTS}/${MAX_ATTEMPTS}); retrying in 2s..."
  sleep 2
done

# Post-push schema verification — the ONLY reliable guard against drizzle-kit's
# known behaviour of exiting 0 even when it silently skips a migration (e.g.
# when it can't resolve a rename-vs-create prompt on a non-TTY). Even when
# push exits 0, the columns it was supposed to create may be absent.
#
# Strategy: query information_schema for a small set of known-critical columns
# that span the core schema plus the hand-rolled migrations. If any are absent
# after push, the sync failed silently and we must not start the app.
VERIFY_FAIL=0

check_column() {
  local tbl="$1" col="$2"
  local result
  # Use || true so set -e doesn't abort on a psql connectivity error; we treat
  # any non-"1" result (including psql failure output) as a verification failure.
  result=$(psql "$DATABASE_URL" -tAc \
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${tbl}' AND column_name='${col}';" 2>&1) || true
  if [ "$result" != "1" ]; then
    echo "[entrypoint] FATAL: post-push verify — ${tbl}.${col} missing (got: ${result:-<empty>})" >&2
    VERIFY_FAIL=1
  fi
}

# Core object-type columns (schema.generated.ts)
check_column "member"             "tier_role"
check_column "member"             "started_at"
# Migration 0005: notification table
check_column "notification"       "recipient_member_id"
# Migration 0006: member_context table
check_column "member_context"     "member_id"
# Migration 0008: approved_views (governed-view registry). This table is a NEW
# table push silently skips on non-TTY stdin — verifying it is what turns that
# skip from a silent loss of the registry into a loud boot failure.
check_column "approved_views"     "descriptors"

if [ "$VERIFY_FAIL" -ne 0 ]; then
  echo "[entrypoint] FATAL: schema verification failed after push — one or more critical columns are absent." >&2
  echo "[entrypoint] This usually means drizzle-kit push exited 0 without applying changes (TTY prompt skipped)." >&2
  exit 1
fi

echo "[entrypoint] schema sync complete (push + verification passed)."

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
