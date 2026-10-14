# Sentry error tracking and uptime

## Why

Know it's broken before anyone tells you.

## Done when

- [ ] `@sentry/node` in `apps/api` and `@sentry/vue` in `apps/web`, installed per package with `--filter`
- [ ] DSNs read from environment; disabled in local dev and tests
- [ ] A test error from each app appears in Sentry (screenshot or link in PR)
- [ ] Sentry uptime monitor on the production `/health` URL with phone alerts

Spec: `docs/spec.md`. Workflow: see "How a session works" in `CLAUDE.md`.
