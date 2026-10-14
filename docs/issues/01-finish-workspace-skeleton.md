# Finish the workspace skeleton

## Why

The root workspace and `apps/web` exist. Bring every package to the same baseline so the rest of M0 has something to check.

## Done when

- [ ] `packages/ledger`, `packages/extract`, `packages/shared` and `apps/api` each have a `package.json` named `@kitchen-ops/<name>`, `"private": true`, `"type": "module"`, and a `src/index.ts`
- [ ] A root `tsconfig.base.json` (strict, ES2023+, `moduleResolution: bundler`) that every package's `tsconfig.json` extends
- [ ] Every package has `test` and `typecheck` scripts; root `pnpm test` and `pnpm typecheck` run them all and pass
- [ ] Root `package.json` has `"engines": { "node": ">=24" }`; `.node-version` contains `24`
- [ ] TypeScript is a single version across the workspace (match the version `vue-tsc` supports)
- [ ] `.gitignore` covers `node_modules/`, `dist/`, `.env*` (except `.env.example`) and `eval/private/`

## Notes

Don't add frameworks yet (no Fastify, no Drizzle). Empty packages are fine.

Spec: `docs/spec.md`. Workflow: see "How a session works" in `CLAUDE.md`.
