# Lint with enforced dependency rules

## Why

Add ESLint (flat config) for TypeScript and Vue, and make the dependency rules from `docs/spec.md` section 2 a lint error.

## Done when

- [ ] `pnpm lint` runs ESLint across the workspace and passes
- [ ] An import that breaks the rules fails lint (e.g. `ledger` importing anything, `web` importing `ledger`). Prove it in the PR with a deliberately broken example and its error output, then remove it
- [ ] Prettier or ESLint stylistic rules decided and documented in the PR, applied once to the existing code

## Notes

Prefer one well-known plugin for boundaries over custom rules. Explain the choice in the PR.

Spec: `docs/spec.md`. Workflow: see "How a session works" in `CLAUDE.md`.
