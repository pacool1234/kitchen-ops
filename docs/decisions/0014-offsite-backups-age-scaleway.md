# 0014. Off-site backups: age-encrypted dumps from a Render cron job

- Status: Accepted
- Date: 2026-10-15

## Context

The spec (section 7, Data) asks for a weekly encrypted database dump in a separate Scaleway bucket, the copy outside Render, and a quarterly restore drill. The production database accepts connections only from inside Render (`ipAllowList: []`), and runs Postgres 18. The dump holds everything, including password hashes and session tokens.

## Decision

A Render cron job in the production environment, `kitchen-ops-db-backup`, runs a small Docker image (`ops/backup`) every Monday at 03:00 UTC.

- **Image:** the official `postgres:18-alpine` image plus `age`, `aws-cli` and `curl`. `pg_dump` refuses to dump a newer server than itself, so the tools must be Postgres 18's; the same image restores the dumps during drills.
- **Dump:** `pg_dump` custom format, without owners or privileges, checked with `pg_restore --list` before it is encrypted.
- **Encryption: `age` with a key pair.** The job has only the public half (in `render.yaml`, where anyone may read it); the private half is in the repo owner's password manager, with a printed copy offline. Whoever gets into Render can make new backups but cannot read old ones.
- **Storage:** bucket `kitchen-ops-db-backups` in its own Scaleway project, versioning on, current versions kept 12 weeks and non-current ones 30 more days. The job's key can only write. Restores download through the Scaleway console.
- **Alerting:** Sentry Crons check-ins at the start and end of each run, so a failed or missing run raises an alert.
- **Tested:** `ops/backup/test.sh` runs a backup and a restore against a throwaway database and a local S3 stand-in on every pull request.

Procedures: `docs/runbooks/restore.md`.

## Alternatives considered

- **A passphrase (`gpg --symmetric` or `age -p`):** the job would need the passphrase, so anyone who reads Render's environment could decrypt every dump.
- **A cron job on Render's native runtime instead of Docker:** its Postgres client tools are whatever version Render installs, not necessarily 18, and `age` would have to be downloaded during the build.
- **Render's "Create export":** a logical backup kept 7 days, on Render. Not independent of Render, and not automated.
- **Running the job outside Render (GitHub Actions):** the database is not reachable from the internet, and opening it up for a weekly job is a worse trade than a $1/month cron job.
- **Scaleway Object Lock (immutable objects):** stronger than versioning against deletion, but locked objects can't be removed early, even by the owner. Worth revisiting when the data is real.
