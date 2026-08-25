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

# The suites raise errors on purpose — that is how "this must not be allowed" is
# proved. So an unexpected error is easy to lose in the noise, and one already
# was. Every suite therefore says how many errors it should raise, and a run
# that raises a different number fails.
FAILED=0
suite() {
  local name="$1" db="$2" file="$3" want="$4" out got
  echo
  echo "=== $name ==="
  out=$(psql -h "$SOCK" -p "$PORT" -U postgres -d "$db" -f "$file" 2>&1)
  echo "$out"
  got=$(printf '%s\n' "$out" | grep -cE '^psql:.*[Ee][Rr][Rr][Oo][Rr]:' || true)
  if [ "$got" != "$want" ]; then
    echo "!! $name raised $got error(s); $want expected — read the output above"
    FAILED=1
  else
    echo "-- $name: $got expected error(s), nothing unexpected"
  fi
}

PSQL="psql -h $SOCK -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database tracker;" >/dev/null
$PSQL -d tracker -f "$HERE/local-stubs.sql" >/dev/null
$PSQL -d tracker -f "$HERE/../supabase/schema.sql" >/dev/null
echo "schema applied cleanly"
$PSQL -d tracker -f "$HERE/../supabase/schema.sql" >/dev/null
echo "schema is re-runnable (idempotent)"
suite "identity and locations" tracker "$HERE/rls-test.sql" 5

$PSQL -c "drop database if exists blocks;" >/dev/null
$PSQL -c "create database blocks;" >/dev/null
$PSQL -d blocks -f "$HERE/local-stubs.sql" >/dev/null
$PSQL -d blocks -f "$HERE/../supabase/schema.sql" >/dev/null
suite "blocks and the shared list" blocks "$HERE/blocks-test.sql" 3

$PSQL -c "drop database if exists writes;" >/dev/null
$PSQL -c "create database writes;" >/dev/null
$PSQL -d writes -f "$HERE/local-stubs.sql" >/dev/null
$PSQL -d writes -f "$HERE/../supabase/schema.sql" >/dev/null
suite "write paths" writes "$HERE/writes-test.sql" 0

echo
$PSQL -c "drop database if exists upgraded;" >/dev/null
$PSQL -c "create database upgraded;" >/dev/null
$PSQL -d upgraded -f "$HERE/local-stubs.sql" >/dev/null
$PSQL -d upgraded -f "$HERE/legacy-shape.sql" >/dev/null
$PSQL -d upgraded -f "$HERE/../supabase/schema.sql" >/dev/null
echo "old project upgraded in place"
suite "upgrade from the previous release" upgraded "$HERE/upgrade-test.sql" 0

$PSQL -c "drop database if exists preserved;" >/dev/null
$PSQL -c "create database preserved;" >/dev/null
$PSQL -d preserved -f "$HERE/local-stubs.sql" >/dev/null
$PSQL -d preserved -f "$HERE/legacy-shape.sql" >/dev/null
cd "$HERE/.."   # this one reads a fixture by relative path
suite "data preservation on upgrade" preserved test/preserve-test.sql 0

echo
if [ "$FAILED" = "0" ]; then
  echo "All database suites passed"
else
  echo "Some database suites failed — see the !! lines above"
  exit 1
fi
