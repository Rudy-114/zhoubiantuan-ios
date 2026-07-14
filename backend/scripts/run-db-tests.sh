#!/usr/bin/env bash
set -euo pipefail

PG_BINDIR="${PG_BINDIR:-/opt/homebrew/opt/postgresql@16/bin}"
for binary in initdb pg_ctl createdb dropdb; do
  test -x "$PG_BINDIR/$binary" || {
    printf 'PostgreSQL 16 test binaries missing. Run: brew install postgresql@16\n' >&2
    exit 1
  }
done

# Prevent inherited libpq settings from redirecting setup commands.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE PGOPTIONS PGAPPNAME
unset PGSSLMODE PGREQUIRESSL PGTARGETSESSIONATTRS PGCHANNELBINDING PGSSLCERT PGSSLKEY PGSSLROOTCERT PGSSLCRL PGSSLCRLDIR
unset PGGSSENCMODE PGKRBSRVNAME PGREALM PGSYSCONFDIR

root="$(mktemp -d "${TMPDIR:-/tmp}/zbt-safety-pg.XXXXXX")"
port="${ZBT_TEST_PG_PORT:-55432}"
database="zbt_safety_test_$$"
cluster_started=false
database_created=false
cleanup() {
  if test "$database_created" = true; then
    "$PG_BINDIR/dropdb" -h 127.0.0.1 -p "$port" "$database" >/dev/null 2>&1 || true
  fi
  if test "$cluster_started" = true; then
    "$PG_BINDIR/pg_ctl" -D "$root/data" -m fast stop >/dev/null 2>&1 || true
  fi
  rm -rf "$root"
}
trap cleanup EXIT

"$PG_BINDIR/initdb" -D "$root/data" --auth=trust --no-locale \
  --set max_connections=20 --set shared_buffers=16MB >/dev/null
"$PG_BINDIR/pg_ctl" -D "$root/data" -o "-h 127.0.0.1 -p $port" -w start >/dev/null
cluster_started=true
"$PG_BINDIR/createdb" -h 127.0.0.1 -p "$port" "$database"
database_created=true

export NODE_ENV=test
export DATABASE_URL="postgresql://127.0.0.1:$port/$database"
export DB_HOST=""
export DB_NAME=""
export DB_USER=""
export DB_PASSWORD=""
export JWT_SECRET="test-jwt-secret-with-more-than-thirty-two-characters"
export EMAIL_CODE_SECRET="test-email-secret-with-more-than-thirty-two-characters"
export OSS_BUCKET="test-bucket"
export OSS_REGION="cn-shanghai"
export OSS_ENDPOINT="oss-cn-shanghai.aliyuncs.com"
export ALIYUN_ACCESS_KEY_ID="test-access-key"
export ALIYUN_ACCESS_KEY_SECRET="test-access-secret"
export SAFETY_CASES_ENABLED=true
export SAFETY_AI_MODE=off

node scripts/migrate.js
tests=()
while IFS= read -r file; do tests+=("$file"); done < <(find test -type f -name '*.integration.test.js' | sort)
if test "${#tests[@]}" -eq 0; then
  printf 'No database integration tests found.\n'
else
  node --test --test-concurrency=1 "${tests[@]}"
fi
