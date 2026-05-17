#!/usr/bin/env bash
# Runs drizzle migrations against $DATABASE_URL on every boot (drizzle-kit
# tracks applied migrations via meta/_journal.json, so re-runs are idempotent),
# then hands control to the application command.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required for migrations}"

echo "[entrypoint] applying database migrations..."

ATTEMPTS=0
MAX_ATTEMPTS=30
until npx --no-install drizzle-kit migrate; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    echo "[entrypoint] migration retries exhausted after ${MAX_ATTEMPTS} attempts" >&2
    exit 1
  fi
  echo "[entrypoint] migration failed (attempt ${ATTEMPTS}/${MAX_ATTEMPTS}); retrying in 2s..."
  sleep 2
done

echo "[entrypoint] migrations complete; starting: $*"
exec "$@"
