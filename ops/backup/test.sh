#!/usr/bin/env bash
# Round trip of the backup image: back up a database with synthetic data to a local stand-in for
# Scaleway, then decrypt and restore the uploaded file into a new database and compare.
# Runs in CI. Locally, with Docker running: bash ops/backup/test.sh
set -euo pipefail
cd "$(dirname "$0")"
# Git Bash on Windows would otherwise rewrite container paths such as /tmp/key.
export MSYS_NO_PATHCONV=1

# Throwaway credentials for the S3 stand-in, made up for this run.
S3_TEST_ACCESS_KEY="test-$(openssl rand -hex 8)"
S3_TEST_SECRET_KEY="$(openssl rand -hex 20)"
export S3_TEST_ACCESS_KEY S3_TEST_SECRET_KEY

bucket=kitchen-ops-db-backups
tmp=$(mktemp -d)
compose() { docker compose -f compose.test.yaml "$@"; }
# A one-off container from the backup image, with stdin passed through.
run() { compose run --rm --no-deps -T "$@"; }
sql() { run --entrypoint psql backup -X -q -v ON_ERROR_STOP=1 -tA "$@"; }
fail() {
  echo "FAIL: $*" >&2
  exit 1
}
cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

compose build --quiet backup
compose up -d --wait db s3

echo "--- Sentry expects the job on render.yaml's schedule"
schedule=$(sed -n 's/^ *schedule: *"\([^"]*\)".*/\1/p' ../../render.yaml)
[ -n "$schedule" ] || fail "no schedule found in render.yaml"
grep -qF "\"value\":\"$schedule\"" backup.sh ||
  fail "render.yaml runs the job at '$schedule', but MONITOR_CONFIG in backup.sh says otherwise"

echo "--- Synthetic data: two schemas, a uuidv7 default, an identity column and a foreign key"
sql -d kitchen_ops <<'SQL'
create table product (id uuid primary key default uuidv7(), name text not null unique);
insert into product (name) select 'Synthetic product ' || n from generate_series(1, 200) n;
create table movement (
  id bigint generated always as identity primary key,
  product_id uuid not null references product,
  quantity bigint not null
);
insert into movement (product_id, quantity) select id, 1000 from product;
create schema drizzle;
create table drizzle.migrations (id serial primary key, hash text not null);
insert into drizzle.migrations (hash) values ('first'), ('second');
SQL
fingerprint="
  select (select count(*) || ' ' || md5(string_agg(id || name, ',' order by id)) from product)
    || ' / ' || (select count(*) || ' ' || md5(string_agg(id || ' ' || quantity, ',' order by id)) from movement)
    || ' / ' || (select count(*) from drizzle.migrations)"
original=$(sql -d kitchen_ops -c "$fingerprint")

echo "--- Throwaway key pair"
identity=$(run --entrypoint age-keygen backup 2>/dev/null)
recipient=$(printf '%s\n' "$identity" | run --entrypoint age-keygen backup -y)
[[ $recipient == age1* ]] || fail "age-keygen -y did not print a public key"

echo "--- Refuses to run without the public key"
if run backup >"$tmp/out" 2>&1; then fail "backup.sh ran without BACKUP_AGE_RECIPIENT"; fi
grep -q BACKUP_AGE_RECIPIENT "$tmp/out" || fail "no message about BACKUP_AGE_RECIPIENT: $(cat "$tmp/out")"

echo "--- Backup"
out=$(run -e BACKUP_AGE_RECIPIENT="$recipient" backup)
echo "$out"
object=$(printf '%s\n' "$out" | sed -n "s#^Uploaded s3://$bucket/\([^ ]*\) .*#\1#p")
[[ $object =~ ^kitchen-ops-db/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.dump\.age$ ]] ||
  fail "unexpected object name '$object'"
printf '%s\n' "$out" | grep -qF "(3 tables,"|| fail "expected 3 tables in the dump"

echo "--- The uploaded file is encrypted"
run --entrypoint aws backup s3 cp --only-show-errors "s3://$bucket/$object" - >"$tmp/db.dump.age"
[ "$(head -c 21 "$tmp/db.dump.age")" = "age-encryption.org/v1" ] || fail "not an age file"
if grep -qa "Synthetic product" "$tmp/db.dump.age"; then fail "the uploaded file contains plain data"; fi

# restore.sh needs the dump and the key as files: pass them on stdin and in a variable.
restore() {
  local key=$1
  shift
  run -e KEY="$key" --entrypoint sh backup -c \
    'printf "%s\n" "$KEY" > /tmp/key && cat > /tmp/db.dump.age && restore.sh /tmp/db.dump.age /tmp/key "$@"' \
    restore "$@" <"$tmp/db.dump.age"
}

echo "--- A different key cannot decrypt it"
other=$(run --entrypoint age-keygen backup 2>/dev/null)
if restore "$other" wrong_key >"$tmp/out" 2>&1; then fail "restored with the wrong key"; fi
grep -q "no identity matched" "$tmp/out" || fail "unexpected error: $(cat "$tmp/out")"
[ -z "$(sql -d postgres -c "select 1 from pg_database where datname = 'wrong_key'")" ] ||
  fail "a failed decryption left a database behind"

echo "--- Restore, with the key file as Windows Notepad may save it (byte-order mark, CRLF)"
windows_key="$(printf '\357\273\277')$(printf '%s\n' "$identity" | sed 's/$/\r/')"
restore "$windows_key" restored >"$tmp/out" 2>&1 || fail "the restore failed: $(cat "$tmp/out")"
cat "$tmp/out"
grep -Eq "public\.product +\| +200" "$tmp/out" || fail "restore.sh did not report 200 products"
[ "$(sql -d restored -c "$fingerprint")" = "$original" ] || fail "the restored data differs from the original"
# The identity column carries on after the last restored ID, so new rows don't collide.
next=$(sql -d restored -c "insert into movement (product_id, quantity) select id, 1 from product limit 1 returning id")
[ "$next" = 201 ] || fail "the next movement ID is $next, expected 201"

echo "--- Refuses to restore into an existing database"
if restore "$identity" restored >"$tmp/out" 2>&1; then fail "restored over an existing database"; fi
grep -q "already exists" "$tmp/out" || fail "unexpected error: $(cat "$tmp/out")"

echo "PASS: backup and restore round trip"
