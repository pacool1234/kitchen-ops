# Local Postgres and Drizzle migrations

## Why

Database in place with the migration workflow the spec requires.

## Done when

- [ ] `docker compose up` starts Postgres locally; README explains it
- [ ] Drizzle configured in `apps/api`; one first table (`products`: id, name, base_unit, active, created_at) and its generated migration
- [ ] Scripts: `db:generate`, `db:migrate`, `db:seed` (synthetic data only)
- [ ] CI runs the migrations against a Postgres service container
- [ ] PR description includes the generated SQL

## Notes

Base unit is an enum of `g`, `ml`, `unit` (spec section 3).

Spec: `docs/spec.md`. Workflow: see "How a session works" in `CLAUDE.md`.
