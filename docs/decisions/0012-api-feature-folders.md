# 0012. API code is organised by feature

- Status: Accepted
- Date: 2026-10-15

## Context

`apps/api` started with a `routes/` folder holding two endpoints. The first real feature (products) raised the question of how the API grows. In Fastify, a route declaration already holds what an MVC controller would: URL, request and response schemas (Zod, from `packages/shared`), allowed roles (`config.roles`, checked by the auth hook) and the handler. Business rules live in `packages/ledger`, so a separate "services" layer would mostly pass calls through.

## Decision

One folder per feature under `apps/api/src/`, holding everything that changes together:

```
src/products/
  routes.ts          # Fastify plugin: URLs, schemas, roles, thin handlers
  queries.ts         # Drizzle queries for this feature
  products.test.ts
```

- Handlers stay thin: take the validated input, call `packages/ledger` and/or the feature's queries, return the result.
- Each feature's `routes.ts` is a Fastify plugin registered in `app.ts`, receiving what it needs (e.g. `db`) as plugin options.
- Shared infrastructure stays in its own folders: `db/` (client, schema, migrations, seed), `auth/` (Better Auth, the role hook, `/api/me`), `test/` (helpers).
- Route files are called `routes.ts`, not `controller.ts`.

## Alternatives considered

Layer folders (`routes/`, `services/`, `repositories/`): familiar from MVC, but one feature is spread across three folders, and the services layer would be mostly empty because the domain rules are in `packages/ledger`.
