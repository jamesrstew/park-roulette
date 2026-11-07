#!/usr/bin/env bash
# Starts a throwaway Postgres 16 cluster in ./.pgdata on port 5544.
set -euo pipefail
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/.pgdata"
if [ ! -d "$DIR" ]; then
  "$PG_BIN/initdb" -D "$DIR" -U postgres --auth=trust >/dev/null
fi
if ! "$PG_BIN/pg_ctl" -D "$DIR" status >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$DIR" -o "-p 5544 -k /tmp" -l "$DIR/../.pglog" start >/dev/null
  sleep 1
fi
"$PG_BIN/psql" -h localhost -p 5544 -U postgres -tc "select 1 from pg_database where datname='park_roulette'" | grep -q 1 \
  || "$PG_BIN/createdb" -h localhost -p 5544 -U postgres park_roulette
echo "Postgres ready: postgres://postgres@localhost:5544/park_roulette"
