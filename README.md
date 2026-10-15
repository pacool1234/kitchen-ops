# kitchen-ops

[![CI](https://github.com/pacool1234/kitchen-ops/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/pacool1234/kitchen-ops/actions/workflows/ci.yml)

Reusable building blocks for restaurant purchasing and stock control: a deployed walking skeleton, a stock ledger library and a supplier-document extraction pipeline.

| Path               | What it is                                  |
| ------------------ | ------------------------------------------- |
| `apps/web`         | Vue 3 PWA                                   |
| `apps/api`         | HTTP API                                    |
| `packages/ledger`  | Pure stock and costing logic, no I/O        |
| `packages/extract` | Supplier documents → structured lines       |
| `packages/shared`  | Zod schemas and types shared by web and api |

## Getting started

Node 24 (see `.node-version`) and pnpm 10 (`corepack enable` picks the pinned version).

```sh
pnpm install
docker compose up -d   # API tests need Postgres (see Database)
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @kitchen-ops/web dev
```

CI runs the same checks, plus a secret scan, the database migrations and a build, on every pull request.

## Database

Local Postgres 18 runs in Docker ([Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows and macOS).

```sh
docker compose up -d                  # start Postgres on 127.0.0.1:5432 (data kept in a Docker volume)
cp apps/api/.env.example apps/api/.env  # first time only, then set BETTER_AUTH_SECRET (below)
pnpm --filter @kitchen-ops/api db:migrate
pnpm --filter @kitchen-ops/api db:seed  # synthetic products and users; each skipped if any exist
```

`BETTER_AUTH_SECRET` signs session cookies and encrypts 2FA secrets. Generate your own for `apps/api/.env`:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The seed creates one **local-only** login per role. The passwords are deliberately fake; never use them anywhere real.

| Email                  | Password             | Role    |
| ---------------------- | -------------------- | ------- |
| `counter@example.test` | `local-only-counter` | counter |
| `office@example.test`  | `local-only-office`  | office  |
| `owner@example.test`   | `local-only-owner`   | owner   |

Owners must use 2FA: until the owner sets up an authenticator app (`POST /api/auth/two-factor/enable`, then `/two-factor/verify-totp`), every protected route answers `403 two_factor_required`.

API tests use a separate `kitchen_ops_test` database on the same server, created and migrated automatically, so they never touch your development data.

Changing the schema (`apps/api/src/db/schema.ts`):

```sh
pnpm --filter @kitchen-ops/api db:generate --name=<what_changed>   # writes SQL to apps/api/drizzle/
pnpm --filter @kitchen-ops/api db:migrate
```

Read the generated SQL before committing it, and paste it into the PR. Never edit a migration that has already been applied; write a new one. CI fails if the schema and the migrations are out of sync.

`docker compose down` stops the database; `docker compose down -v` also deletes its data.

## Web app

The web app and the API share one address: the browser only talks to the web app's origin, which forwards `/api/*` to the API. Session cookies stay first-party and no CORS is needed. On Render the static site forwards `/api/*` the same way.

```sh
pnpm --filter @kitchen-ops/api dev   # API on 127.0.0.1:3000
pnpm --filter @kitchen-ops/web dev   # open http://localhost:5173
```

`BETTER_AUTH_URL` in `apps/api/.env` must be the address in the browser, `http://localhost:5173`. Better Auth rejects sign-ins from any other origin, so open `localhost`, not `127.0.0.1`.

To try the installable version (service worker included): `pnpm --filter @kitchen-ops/web build`, then `pnpm --filter @kitchen-ops/web preview` (same address). The service worker caches only the app itself, never `/api` responses.

The icons in `apps/web/public/` are generated from `icon.svg`, a placeholder until there is a real design: `pnpm --filter @kitchen-ops/web generate-pwa-assets`.

## Docs

- `docs/spec.md`: the spec
- `docs/decisions/`: decision records, with the reasons
