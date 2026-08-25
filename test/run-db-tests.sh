#!/usr/bin/env bash
# Applies supabase/schema.sql to a throwaway Postgres and runs the RLS suite.
# Needs postgresql-16 client + server binaries locally. Supabase itself is not
# required — test/local-stubs.sql stands in for auth.users, storage and realtime.
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/var/tmp/pgtest-tracker}
SOCK=${SOCK:-/var/tmp/pgsock-tracker}
PORT=${PORT:-55432}
HERE="$(cd "$(dirname "$0")" && pwd)"

export PATH="$PGBIN:$PATH"

cleanup() {
  [ -n "${KEEP_RUNNING:-}" ] && return 0     # KEEP_RUNNING=1 leaves the cluster up for poking at
  pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true
}
trap cleanup EXIT

# a previous run may still be holding the port
pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true
pkill -f "postgres.*-p ${PORT}" >/dev/null 2>&1 || true
sleep 1

rm -rf "$PGDATA"; mkdir -p "$PGDATA" "$SOCK"
if id postgres >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
  chown -R postgres "$PGDATA" "$SOCK"; chmod 700 "$PGDATA"
  RUN="su postgres -c"
else
  RUN="bash -c"
fi

$RUN "PATH=$PGBIN:\$PATH initdb -D $PGDATA --auth=trust" >/dev/null
$RUN "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -o '-k $SOCK -p $PORT -c listen_addresses=' -l $PGDATA/log start" >/dev/null
sleep 2

PSQL="psql -h $SOCK -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database tracker;" >/dev/null
$PSQL -d tracker -f "$HERE/local-stubs.sql" >/dev/null
$PSQL -d tracker -f "$HERE/../supabase/schema.sql" >/dev/null
echo "schema applied cleanly"
$PSQL -d tracker -f "$HERE/../supabase/schema.sql" >/dev/null
echo "schema is re-runnable (idempotent)"
psql -h "$SOCK" -p "$PORT" -U postgres -d tracker -f "$HERE/rls-test.sql"

echo
echo "=== blocks ==="
$PSQL -c "drop database if exists blocks;" >/dev/null
$PSQL -c "create database blocks;" >/dev/null
$PSQL -d blocks -f "$HERE/local-stubs.sql" >/dev/null
$PSQL -d blocks -f "$HERE/../supabase/schema.sql" >/dev/null
psql -h "$SOCK" -p "$PORT" -U postgres -d blocks -f "$HERE/blocks-test.sql"

echo
echo "=== write paths ==="
$PSQL -c "drop database if exists writes;" >/dev/null
$PSQL -c "create database writes;" >/dev/null
$PSQL -d writes -f "$HERE/local-stubs.sql" >/dev/null
$PSQL -d writes -f "$HERE/../supabase/schema.sql" >/dev/null
psql -h "$SOCK" -p "$PORT" -U postgres -d writes -f "$HERE/writes-test.sql"
