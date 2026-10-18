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

## What exists so far

- **Deployed:** the web app and the API, with sign-in, roles, owner 2FA and a list of products.
- **The stock ledger:** complete as a library, tested against every invariant in the spec. The API doesn't use it yet.
- **The extraction pipeline:** it routes, extracts and validates supplier documents, and an eval harness measures it. Matching to products, review and posting aren't built, and the API doesn't call it yet.
- **Infrastructure:** backups, monitoring and production releases are live.

`docs/architecture.md` has the details: what each part does today and what isn't built yet.

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

## Stock ledger

`packages/ledger` holds the rules of spec section 4: movements and stock on hand, unit conversions, posting and reversing documents, weighted-average cost, yields and variance.
- **Pure TypeScript:** no I/O and no runtime dependencies, so it is tested without a database.
- **Movements are append-only:** a correction is a reversing movement.
- **Money is never a JavaScript `number`:** totals are `bigint` cents and unit costs are `bigint` millionths (decision 0015).

```sh
pnpm --filter @kitchen-ops/ledger test            # includes a property test for each invariant
pnpm --filter @kitchen-ops/ledger test:coverage
```

Its modules, and which test covers each invariant, are listed in [`packages/ledger/README.md`](packages/ledger/README.md). A test fails if that list falls out of date.

## Extraction and eval

`packages/extract` turns a supplier document into checked JSON:
- **Facturae XML** is read directly;
- **text PDFs** go to a model as text;
- **scans and photos** go to a model as images.

Every model reply is checked against the schema in `packages/shared`, then by the validation checks: values present, line totals and their sum, VAT, the total, the tax ID's checksum, the date, and a duplicate number. Models are called through OpenRouter (decision 0007).

**Setup:** put your OpenRouter key in `packages/extract/.env`, as `OPENROUTER_API_KEY` (see `packages/extract/.env.example`). The eval loads it from there. Unit tests never call a model.

### Running an eval

An eval runs one prompt with one or more models over a set of documents. It reports the silent error rate first (documents that pass validation but are wrong), then the review rate, field accuracy, cost and latency.

```sh
pnpm --filter @kitchen-ops/extract eval -- --set gold --model google/gemini-3.8-flash --prompt v2
pnpm --filter @kitchen-ops/extract eval -- --set gold --model openai/gpt-6-luna --model google/gemini-3.8-flash --prompt v2 --max-usd 0.50
```

- **Calls cost money.** A run stops at its spending cap: `--max-usd`, or $1.00 from `packages/extract/config/eval.json`. Agree each paid run, and its expected cost, with the repo owner first.
- **Models** must be listed in `packages/extract/config/models.json`, which also sets each one's structured output and temperature. Its `default` is the model and prompt the pipeline uses: Gemini 3.8 Flash with prompt v2 (decision 0018).
- **Prompts** are versioned files in `packages/extract/prompts/` (`v1.md`, `v2.md`). A new prompt is a new file, so runs stay comparable.
- **Results** go to `eval/results/<date>-<model>-<prompt>.json`, with a Markdown summary next to it. They are committed and never overwritten. Running the same model and prompt again the same day writes `-run2`, `-run3`, and so on.

To compare runs side by side, including the spread across repeated runs:

```sh
pnpm --filter @kitchen-ops/extract eval:compare -- eval/results/<file>.json eval/results/<file>.json
```

### The gold set

`eval/gold/` holds the committed test documents: own, public or synthetic, never a client's. [`eval/gold/README.md`](eval/gold/README.md) lists them and what makes each one hard. Each folder has three files:
- **`source.*`:** the document (PDF, JPEG, PNG or XML);
- **`expected.json`:** the right answer, written or checked by a person, never copied from a model;
- **`meta.json`:** its origin, its kind, for a synthetic text PDF how it was made, notes, and who checked it and when.

To add a document:
1. **Create its folder** with those three files.
2. **Remove any metadata from photos** first, such as location or camera. The repo is public, and a test refuses images that carry metadata.
3. **For a synthetic PDF marked `"made": "rendered"`,** run `pnpm --filter @kitchen-ops/extract gold:render` to write its `source.pdf` from `expected.json`.
4. **Rewrite the list:** `pnpm --filter @kitchen-ops/extract gold:readme`. A test fails if it's out of date.

### The private set

Client documents are never committed. They stay in a folder outside the repository (or a git-ignored one), named by `EVAL_PRIVATE_DIR` in `packages/extract/.env`, with the same layout as the gold set.
- **Only the repo owner runs them,** with `--set private`.
- **Calls are restricted** to providers that neither train on nor keep the data.
- **Results go to a `results` folder inside the private set,** never to the repo. They keep no value read, and name documents by hash.

## Deploying

Render, Frankfurt region, defined in `render.yaml` (a Render Blueprint):

| Environment | Web app                                        | API health                                            | Deploys                                           |
| ----------- | ---------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Staging     | https://kitchen-ops-web-staging.onrender.com   | https://kitchen-ops-api-staging.onrender.com/health   | every commit on `main`, once CI passes            |
| Production  | https://kitchen-ops-web.onrender.com           | https://kitchen-ops-api.onrender.com/health           | a release tag (below)                             |

`/health` answers `{"status":"ok","version":"<git commit>"}`, so you can see which commit is running. The staging API is on Render's free plan and sleeps after 15 minutes without traffic; the first request then takes about a minute.

Each deploy applies the database migrations before the new version takes traffic. If a migration fails, the deploy fails and the previous version keeps running. The seed never runs on Render.

**Changing `render.yaml`:** the Blueprint applies changes only when you click **Manual Sync** on its page in Render. A sync that changes a service also redeploys it from the latest commit on `main`, **production included**, without a release tag. Sync only when `main` is ready for production, ideally right after releasing it.

Successful `/health` calls are not logged: Render's own health check calls it every few seconds. Failures are.

### Releasing to production

Tag the commit staging runs (the `version` on staging's `/health`), then push the tag:

```sh
git tag -a v0.1.0 <commit> -m "v0.1.0"
git push origin v0.1.0
```

The "Deploy production" workflow checks that the commit is on `main` and that staging runs it. It then deploys the API and the web app to production and waits until production's `/health` reports that commit.

### One-time setup (repo owner, by hand)

1. In Render, create a workspace with a payment method, then **New → Blueprint**, pick this repo and apply `render.yaml`. Render shows everything it will create first.
   - Pick the repo from your connected GitHub account. If it isn't listed, give Render's GitHub app access to it first (https://github.com/apps/render/installations/new → **Configure** → **Repository access**). Never paste the repo's public URL instead: services and Blueprints linked by URL are never told about new commits, so they don't deploy or sync on their own.
   - If that already happened: in each service, **Settings → Build → Source → Edit** switches it to the connected repo. A Blueprint can't be switched; click **Manual Sync** on its page after changing `render.yaml`.
2. Render generates each environment's `BETTER_AUTH_SECRET`. Copy both into your password manager: losing one signs everyone out and makes the owners' 2FA unusable.
3. In GitHub, **Settings → Environments → New environment** `production`. Allow only tags matching `v*` to deploy to it, and add two secrets: `RENDER_DEPLOY_HOOK_API` and `RENDER_DEPLOY_HOOK_WEB`, the deploy hook URLs from each production service's **Settings** in Render. Treat them like passwords.
4. Set up a billing alert. Every provider needs one (spec section 7).

If Render adds a suffix to a service name because it was taken, update the addresses in `render.yaml`, in `.github/workflows/deploy-production.yml` and in the table above.

## Monitoring

Sentry (EU region), one project per app: `kitchen-ops-api` and `kitchen-ops-web`. Staging and production share them; each error is tagged with its `environment` and with the commit as its `release`.

- **What is sent:** errors and their stack traces only. No performance tracing, no session replay, and nothing personal or request-specific: no IP addresses, cookies, headers, bodies or query values. API errors carry the user's ID (a UUID) and the `request_id`, which is the `reqId` in Render's logs, so the details are found there.
- **API:** 5xx errors from routes and hooks, and crashes. 4xx answers are not errors. Sentry starts from `src/instrument.ts`, loaded before the app (see the `start` script), and only when `SENTRY_DSN` is set. The first log line says whether it is on.
- **Web:** uncaught errors in the built app, and only when the build had `VITE_SENTRY_DSN`. Never in `dev`. The browser also sends Sentry's "session" counts (pages opened with or without an error), for crash-free rates per release.
- **Locally and in tests** none of these variables are set, so Sentry stays off.

| Render service    | Variables                                                                 |
| ----------------- | ------------------------------------------------------------------------- |
| both APIs         | `SENTRY_DSN` (API project, entered in the dashboard), `SENTRY_ENVIRONMENT` |
| both static sites | `VITE_SENTRY_DSN` (web project, entered in the dashboard), `VITE_SENTRY_ENVIRONMENT` |

`VITE_` variables are built into the browser code at build time, so changing one needs a redeploy of the static site. A DSN only allows sending events, not reading them; the web one is visible to anyone using the app.

**Test errors:**

- Web: open any page with `#sentry-test` at the end of the address, e.g. `https://kitchen-ops-web-staging.onrender.com/login#sentry-test`.
- API: in the production API's **Shell** tab in Render, run `cd apps/api && node --import tsx src/sentry-test.ts`. Locally: `SENTRY_DSN=<dsn> pnpm --filter @kitchen-ops/api sentry:test`.

**Uptime:** a Sentry uptime monitor calls `https://kitchen-ops-api.onrender.com/health` and alerts by email. Staging is not monitored: its free API sleeps when idle.

## Backups

The production database has two copies: Render's point-in-time recovery (past 3 days), and a weekly encrypted dump in a Scaleway bucket (kept 12 weeks), made by the cron job `kitchen-ops-db-backup` from `ops/backup`. Sentry alerts when a weekly run fails or doesn't happen.

How to restore from either, the retention rules, the one-time setup and the record of restore drills: [`docs/runbooks/restore.md`](docs/runbooks/restore.md). Why it works this way: decision 0014.

`bash ops/backup/test.sh` (Docker needed) runs a full backup and restore against a throwaway database; CI runs it on every pull request.

## Docs

- `docs/spec.md`: the spec, the plan
- `docs/architecture.md`: what's built so far, and what isn't yet
- `docs/decisions/`: decision records, with the reasons
- `docs/runbooks/`: step-by-step procedures (restoring the database)
- `packages/ledger/README.md`: the ledger's modules and invariant tests
- `eval/gold/README.md`: the gold set's documents
