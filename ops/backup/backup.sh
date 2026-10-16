#!/bin/sh
# Off-site database backup, run weekly by Render (kitchen-ops-db-backup in render.yaml): dump the
# database, check the dump can be read back, encrypt it for the backup key and upload it to the
# Scaleway bucket. Restoring: docs/runbooks/restore.md.
#
# Prints names, sizes and checksums only, never data or credentials.
set -eu

# Sentry Crons: one check-in when a run starts and one when it ends. Sentry alerts when a run fails
# or doesn't happen at all. The first check-in creates the monitor. The schedule must match
# render.yaml (ops/backup/test.sh checks it).
MONITOR_SLUG=kitchen-ops-db-backup
MONITOR_CONFIG='{"schedule":{"type":"crontab","value":"0 3 * * 1"},"timezone":"UTC","checkin_margin":60,"max_runtime":30,"failure_issue_threshold":1,"recovery_threshold":1}'

checkin() {
  # Off without a DSN (locally and in tests).
  [ -n "${SENTRY_DSN:-}" ] || return 0
  # The DSN is https://<public key>@<host>/<project ID>.
  key=${SENTRY_DSN#https://}
  key=${key%%@*}
  host=${SENTRY_DSN#*@}
  host=${host%%/*}
  project=${SENTRY_DSN##*/}
  curl -fsS --max-time 10 -o /dev/null -X POST \
    -H 'Content-Type: application/json' \
    --data "{\"status\":\"$1\",\"monitor_config\":$MONITOR_CONFIG}" \
    "https://$host/api/$project/cron/$MONITOR_SLUG/$key/?environment=${SENTRY_ENVIRONMENT:-production}" ||
    echo "Could not send Sentry check-in '$1'; carrying on." >&2
}

work=$(mktemp -d)
finish() {
  status=$?
  rm -rf "$work"
  if [ "$status" -ne 0 ]; then
    echo "Backup failed." >&2
    checkin error
  fi
}
trap finish EXIT
checkin in_progress

: "${DATABASE_URL:?is not set}"
: "${BACKUP_AGE_RECIPIENT:?is not set (the backup key's public half, age1...)}"
: "${BACKUP_S3_BUCKET:?is not set}"
: "${AWS_ENDPOINT_URL:?is not set}"
: "${AWS_ACCESS_KEY_ID:?is not set}"
: "${AWS_SECRET_ACCESS_KEY:?is not set}"

object="kitchen-ops-db/$(date -u +%Y-%m-%dT%H%M%SZ).dump.age"

# Custom format: compressed, and pg_restore can restore all of it or single tables. No owner or
# privileges, so it restores into any database under any user.
pg_dump --format=custom --no-owner --no-acl --file="$work/db.dump" "$DATABASE_URL"

# A dump pg_restore can't read would otherwise only be found during a restore.
tables=$(pg_restore --list "$work/db.dump" | grep -c ' TABLE DATA ' || true)

# Only the public key is here: this job can encrypt, never decrypt.
age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$work/db.dump.age" "$work/db.dump"
rm "$work/db.dump"
size=$(wc -c <"$work/db.dump.age" | tr -d ' ')
sha256=$(sha256sum "$work/db.dump.age" | cut -d ' ' -f 1)

aws s3 cp --only-show-errors "$work/db.dump.age" "s3://$BACKUP_S3_BUCKET/$object"

echo "Uploaded s3://$BACKUP_S3_BUCKET/$object ($tables tables, $size bytes, sha256 $sha256)"
checkin ok
