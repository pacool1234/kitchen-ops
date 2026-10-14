# CI workflow on every pull request

## Why

GitHub Actions runs the same checks you run locally, so done means CI is green.

## Done when

- [ ] `.github/workflows/ci.yml` runs on pull requests and pushes to `main`: install (pnpm cache, Node from `.node-version`) → lint → typecheck → test → build
- [ ] A step fails the build if any tracked file is under `eval/private/`
- [ ] A secret-scanning step (e.g. gitleaks) runs and passes
- [ ] Branch protection on `main` requires CI to pass (repo owner sets this in GitHub settings; document the steps in the PR)
- [ ] README has a CI status badge

Spec: `docs/spec.md`. Workflow: see "How a session works" in `CLAUDE.md`.
