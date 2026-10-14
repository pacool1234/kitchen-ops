# Off-site backups and a restore drill

## Why

The independent copy and proof that restore works.

## Done when

- [ ] Weekly Render cron job runs `pg_dump`, encrypts it, and uploads to a Scaleway bucket (EU, versioning on) separate from the files bucket
- [ ] Retention policy on the bucket documented (e.g. 12 weeks)
- [ ] `docs/runbooks/restore.md` describes both restores: Render point-in-time recovery and restoring a Scaleway dump into a scratch database
- [ ] One restore performed into a scratch database and recorded in the runbook with date and result

## Notes

The repo owner performs the restore; Claude writes the scripts and runbook.

Spec: `docs/spec.md`. Workflow: see "How a session works" in `CLAUDE.md`.
