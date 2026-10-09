#!/usr/bin/env bash
# Run the database isolation tests against a throwaway local PostgreSQL 15+ cluster.
#
# Usage:  npm run test:db
#   - Uses PostgreSQL binaries from PG_BIN (default: /usr/lib/postgresql/16/bin).
#   - Applies supabase/tests/local_supabase_stub.sql (roles + auth stand-in), then every
#     migration in supabase/migrations in order, then runs supabase/tests/*.test.ts.
#   - Nothing here touches a real Supabase project or needs credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGTEST_PORT:-54329}"
DIR="$ROOT/.pgtest"

if [[ ! -x "$PG_BIN/initdb" ]]; then
  echo "PostgreSQL binaries not found in $PG_BIN. Install PostgreSQL 15+ or set PG_BIN." >&2
  exit 2
fi

run_pg() {
  if [[ "$(id -u)" == "0" ]]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi
}

rm -rf "$DIR"
mkdir -p "$DIR"
[[ "$(id -u)" == "0" ]] && chown postgres "$DIR"

run_pg "'$PG_BIN/initdb' -D '$DIR/data' -A trust -U postgres --no-instructions" >/dev/null
run_pg "'$PG_BIN/pg_ctl' -D '$DIR/data' -o '-p $PORT -k $DIR -c listen_addresses=127.0.0.1' -l '$DIR/log' -w start" >/dev/null
cleanup() { run_pg "'$PG_BIN/pg_ctl' -D '$DIR/data' -m fast -w stop" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/supabase/tests/local_supabase_stub.sql"
for m in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$m")"
  "${PSQL[@]}" -f "$m"
done

PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres \
  npx vitest run --config "$ROOT/vitest.db.config.ts"
