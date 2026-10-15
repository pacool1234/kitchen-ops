# Restoring the database

The production database (`kitchen-ops-db` on Render) has two independent copies:

| Copy | Where | Goes back | Use it when |
| --- | --- | --- | --- |
| Point-in-time recovery | Render, built in | any moment in the past 3 days (Hobby workspace; 7 on Pro) | data was lost or damaged recently: a bad migration, a mistaken bulk change |
| Weekly dump | Scaleway bucket `kitchen-ops-db-backups` (Paris) | Mondays 03:00 UTC, kept 12 weeks | the problem is older than 3 days, or Render itself is unavailable or the account is lost |

Both hold everything in the database, including password hashes, session tokens and 2FA secrets (the 2FA secrets are encrypted with the environment's `BETTER_AUTH_SECRET`). Treat every restored copy as sensitive, and delete local copies once you are done.

## What you need

- **Render:** dashboard access to the workspace.
- **Scaleway:** console access to the `kitchen-ops-backups` project.
- **The backup key** (password manager, "kitchen-ops backup key"; a printed copy is kept offline). Without it the dumps cannot be read. Its public half (`age1…`) is in `render.yaml`.
- **For a dump restore:** Docker Desktop and this repo, on any computer.

## A. Point-in-time recovery (Render)

Render restores into a **new** database; the original keeps running untouched until you switch.

1. Render → database `kitchen-ops-db` → **Recovery** → **Point-in-Time Recovery** → **Restore Database**.
2. Name it, for example `kitchen-ops-db-recovered`, and pick the date and time to go back to (UTC; not within the last 10 minutes). Keep **Copy Existing Settings**.
3. Wait until its status is **Available**, then check the data with the **PSQL Command** from its **Info** page, for example `select count(*) from products;`.
4. To switch production over, in the dashboard:
   - `kitchen-ops-api` → **Environment** → set `DATABASE_URL` to the new database's **Internal Database URL**, and save (the API redeploys);
   - `kitchen-ops-db-backup` → **Environment** → the same.
5. Do **not** run a Blueprint **Manual Sync** afterwards: `render.yaml` still names `kitchen-ops-db`, and a sync would point both back at the old database. Open an issue to bring `render.yaml` in line first.
6. Once production works on the new database, suspend the old one; delete it only when you are sure.

Steps 4–6 have not been rehearsed. A drill (steps 1–3, then delete the new database) costs only the hours the extra database runs.

## B. Restoring a weekly dump (Scaleway)

This restores into a new database `restore_drill` on the local Postgres in Docker, so it works even without Render. The quarterly drill is this procedure.

In PowerShell, from the repo folder, with Docker Desktop running:

1. Start the local database: `docker compose up -d --wait`.
2. Make the drill folder (git-ignored): `New-Item -ItemType Directory -Force .restore-drill`.
3. Scaleway console → **Object Storage** → `kitchen-ops-db-backups` → folder `kitchen-ops-db` → the newest file (named after its UTC time, e.g. `2026-10-19T030012Z.dump.age`) → **Download**. Move the file into `.restore-drill`.
4. Open Notepad, paste the three lines of the backup key from the password manager and save them as `.restore-drill\backup-key.txt`.
5. Restore:

   ```powershell
   docker compose run --rm restore /drill/2026-10-19T030012Z.dump.age /drill/backup-key.txt
   ```

   It decrypts the file, restores it into the new database `restore_drill` and prints when the dump was made and how many rows each table has. It never restores over an existing database.
6. Check the result:
   - the command ends with the row counts and no error;
   - `drizzle.__drizzle_migrations` has one row per migration in `apps/api/drizzle/` at the release that was running;
   - `public.users` matches the number of people you know have accounts.
7. Clean up:

   ```powershell
   docker compose exec db dropdb -U kitchen_ops restore_drill
   Remove-Item -Recurse -Force .restore-drill
   ```

To bring a dump back into production instead, create a new Render database, allow your IP address in its **Access Control** for the duration, run `restore.sh` against it (`PGHOST`, `PGUSER` and `PGPASSWORD` from its external URL), remove your IP again and switch over as in A, steps 4–6. That has not been rehearsed either; open an issue first if it is ever needed.

## The backup job

- `kitchen-ops-db-backup`, a Render cron job in the production environment (`render.yaml`), runs `ops/backup/backup.sh` every Monday at 03:00 UTC. It dumps the database (`pg_dump`, custom format), checks the dump can be read, encrypts it with the backup key's public half (`age`) and uploads it as `kitchen-ops-db/<UTC time>.dump.age`.
- **Logs:** the job's page in Render. A run ends with `Uploaded s3://kitchen-ops-db-backups/kitchen-ops-db/… (N tables, N bytes, sha256 …)`.
- **Alerts:** each run checks in with Sentry Crons (monitor `kitchen-ops-db-backup`, API project). Sentry emails when a run fails, or when no run has started by Monday 04:00 UTC.
- **Run it now:** the job's page → **Trigger Run**.
- **Updates:** the release workflow deploys the job from the release tag, like the API (`RENDER_DEPLOY_HOOK_BACKUP`).
- **Tested** on every pull request: `bash ops/backup/test.sh` backs up a throwaway database to a local stand-in for Scaleway, then restores it and compares.

## Retention and access

- **Versioning** is on for the bucket.
- **Lifecycle rule `retention`** (bucket → **Lifecycle rules**), for all objects:
  - current versions expire after **84 days** (12 weeks), so about 12 dumps are kept;
  - non-current versions are deleted **30 days** later. A dump that expired, or was overwritten, can still be recovered from the bucket's versions during that time.
- **The job's key** (Scaleway IAM application `kitchen-ops-backup-job`) has one permission set, `ObjectStorageObjectsWrite`, in the `kitchen-ops-backups` project only. It can upload, but not list, download or delete. If Render were compromised, the stored dumps could not be read or deleted with it, and an overwrite would leave the previous version for 30 days.
- **Downloads** for restores go through the Scaleway console, with the repo owner's own login.
- **Changing the backup key:** generate a new pair, put the new public half in `render.yaml` (a pull request, then a release). Keep the old private half until the last dump made with it has expired (12 weeks plus 30 days).

## One-time setup (repo owner, by hand)

1. **Scaleway:** an account with a billing alert; a project `kitchen-ops-backups`; in it the bucket `kitchen-ops-db-backups` (Paris, private) with versioning and the lifecycle rule above.
2. **IAM** (organization menu, top right → **IAM & API keys**): application `kitchen-ops-backup-job` with a policy giving `ObjectStorageObjectsWrite` on the `kitchen-ops-backups` project; an API key for it, preferred project `kitchen-ops-backups`. Store both halves in the password manager.
3. **Backup key:** in your own terminal (never through a tool that records the output), run `docker run --rm alpine:3.22 sh -c "apk add --no-cache -q age && age-keygen"`. Store all three lines in the password manager and keep a printed copy offline; the `age1…` public half goes in `render.yaml`.
4. **Render:** after the release that adds the job, click **Manual Sync** on the Blueprint and enter `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (the Scaleway key) and `SENTRY_DSN` (the API project's) for `kitchen-ops-db-backup`.
5. **GitHub:** the job's deploy hook URL (its **Settings** in Render) as the secret `RENDER_DEPLOY_HOOK_BACKUP` of the `production` environment.
6. **First run:** **Trigger Run**; in Sentry → **Crons**, check the monitor `kitchen-ops-db-backup` appeared and that its alerts reach you. Then run the drill (B) and record it below.

## Drills

The spec asks for a restore into a scratch database every quarter. Add a row each time.

| Date | Dump | Procedure | Result | By |
| --- | --- | --- | --- | --- |
