# Deploy to Render: staging and production

## Why

Infrastructure as code where possible; account setup is done by the repo owner by hand.

## Done when

- [ ] `render.yaml` blueprint defines the static site, API web service and Postgres, all in an EU region
- [ ] Staging deploys on every merge to `main`; production deploys from a tagged release
- [ ] Production Postgres is a paid instance with point-in-time recovery
- [ ] `GET /health` returns OK on both environments; URLs recorded in README
- [ ] Billing alert configured (repo owner, documented in PR)

## Notes

Claude must not handle Render credentials. Secrets are entered by the repo owner in the Render dashboard.

Spec: `docs/spec.md`. Workflow: see "How a session works" in `CLAUDE.md`.
