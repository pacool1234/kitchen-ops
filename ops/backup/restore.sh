#!/bin/sh
# Restores an encrypted dump from the backup bucket into a new database, then prints each table's
# row count. Used for restore drills (docs/runbooks/restore.md):
#
#   restore.sh <dump .age file> <key file> [database, default restore_drill]
#
# Connects with the standard PGHOST, PGUSER and PGPASSWORD variables (docker-compose.yml sets them).
# Never restores over an existing database.
set -eu

if [ $# -lt 2 ]; then
  echo "Usage: restore.sh <dump .age file> <key file> [database, default restore_drill]" >&2
  exit 2
fi
dump=$1
key=$2
database=${3:-restore_drill}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Windows editors may start the key file with a byte-order mark, which age rejects.
bom=$(printf '\357\273\277')
sed "1s/^$bom//" "$key" >"$work/key"

# Decrypt first: a wrong key then fails before anything is created.
age --decrypt --identity "$work/key" --output "$work/db.dump" "$dump"
pg_restore --list "$work/db.dump" | sed -n 's/^; *\(Archive created at\|Dumped from database version\)/\1/p'

if ! createdb "$database"; then
  echo "Restores go into a new database: drop '$database' first, or pass another name." >&2
  exit 1
fi
pg_restore --no-owner --no-acl --exit-on-error --dbname="$database" "$work/db.dump"

echo "Restored into database '$database'. Rows per table:"
psql -X -v ON_ERROR_STOP=1 --dbname="$database" <<'SQL'
select string_agg(
         format('select %L as "table", count(*) as "rows" from %I.%I',
                schemaname || '.' || tablename, schemaname, tablename),
         ' union all ' order by schemaname, tablename) || ' order by 1'
  from pg_tables
 where schemaname not in ('pg_catalog', 'information_schema')
\gexec
SQL
