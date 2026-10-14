# Fastify API skeleton

## Why

Minimal API with the conventions everything else will follow.

## Done when

- [ ] `apps/api` runs with `pnpm --filter @kitchen-ops/api dev` and exposes `GET /health` returning `{ status: "ok", version }`
- [ ] Fastify with a Zod type provider; request and response schemas come from `packages/shared`
- [ ] Structured logs (pino) include a request ID
- [ ] Config read from environment and validated with Zod at startup; missing variables fail fast with a clear message; all variables listed in `.env.example`
- [ ] An integration test hits `/health` using Fastify's `inject` (no real network)

Spec: `docs/spec.md`. Workflow: see "How a session works" in `CLAUDE.md`.
