#!/usr/bin/env bash
# Launch (or relaunch) the book-club second instance — the SAME acropolisOS code
# running a DIFFERENT scenario (book-club-org) at http://localhost:3031, proving
# the substrate is ontology-agnostic, side-by-side with the main hostel :3030.
#
#   bash scripts/run-bookclub-instance.sh      (run from packages/acropolisos)
#
# Robust to main-tree changes: re-syncs book-club-instance/lib from the current
# lib/ (so the shared app/ + lib agree — this is the step that, if skipped after
# a main change, breaks :3031), ensures the bookclub DB exists, then brings up the
# compose service. Boot regenerates the book-club schema from the ontology mount.
#
# Prereq: the main stack (docker compose up) is running — this reuses its network
# (acropolisos_default) + postgres.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> packages/acropolisos

echo "[bc] ensuring 'bookclub' database exists on the shared postgres..."
if ! docker exec acropolisos-postgres psql -U acropolisos -d acropolisos -tAc \
      "SELECT 1 FROM pg_database WHERE datname='bookclub'" | grep -q 1; then
  docker exec acropolisos-postgres psql -U acropolisos -d acropolisos \
      -c "CREATE DATABASE bookclub"
  echo "[bc]   created database 'bookclub'."
fi

echo "[bc] syncing book-club-instance/lib <- current lib/ (keeps the instance's code current)..."
rm -rf book-club-instance/lib
cp -r lib book-club-instance/lib

echo "[bc] (re)launching the book-club instance..."
docker rm -f acropolisos-bc >/dev/null 2>&1 || true
docker compose -p acropolisos-bc -f docker-compose.bookclub.yml up -d

echo "[bc] up -> http://localhost:3031  (DB=bookclub; log in with the book-club steward)"
