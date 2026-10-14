# Better Auth with roles and 2FA

## Why

Login with the three roles from spec section 6.

## Done when

- [ ] Better Auth with the Drizzle adapter; sessions stored in Postgres
- [ ] Roles `counter`, `office`, `owner` stored per user; a Fastify hook enforces role per route
- [ ] 2FA (TOTP) required for `owner` accounts
- [ ] Tests: unauthenticated request → 401; wrong role → 403; right role → 200
- [ ] Seed script creates one user per role with documented local-only passwords

## Notes

Never commit real credentials. Local seed passwords go in `.env.example` comments as obviously fake values.

Spec: `docs/spec.md`. Workflow: see "How a session works" in `CLAUDE.md`.
