# Architecture, as built

`docs/spec.md` is the plan. This page is what exists on `main`, checked against the code on 2026-10-18. Where the two differ, this page says "not yet". The reasons behind each part are in `docs/decisions/`.

## The picture today

```
apps/web (Vue 3 PWA) ──► apps/api (Fastify on Render) ──► Render Postgres (EU, PITR)
                                   │
                                   ├╌╌ packages/ledger    not yet: the API doesn't post movements
                                   └╌╌ packages/extract   not yet: the API doesn't extract documents

packages/extract ──► packages/ledger (line totals, unit costs: decision 0016)
                 └─► LLM via OpenRouter, from the eval command only

ops/backup (Render cron, weekly) ──► Scaleway Object Storage (encrypted DB dumps)
```

The plan's other arrows aren't built yet: the API calling `ledger` and `extract`, and photos and PDFs in object storage. The ledger and the extraction pipeline are complete libraries, used by their tests and by the eval command.

## Apps and packages

| Part | What it does today | Depends on | Not yet |
| --- | --- | --- | --- |
| `apps/web` | Sign-in, owner 2FA setup, and the list of active products. Installable PWA; the service worker caches the app, never `/api`. | `shared` | Documents, review, counts, stock and reports |
| `apps/api` | `GET /health`, Better Auth under `/api/auth/*` with roles and owner 2FA, `GET /api/me`, `GET /api/products`. Tables: `products` and the auth tables (`apps/api/src/db/schema.ts`). | `shared` | Documents, movements, suppliers, stock: anything that uses `ledger` or `extract` |
| `packages/ledger` | Movements, unit conversions, posting and reversing documents, weighted-average cost, latest purchase price, yields, variance. Pure: no I/O, no runtime dependencies. | nothing | Nothing stores its results yet |
| `packages/extract` | Routing, LLM extraction, validation, and the eval harness, with the gold set's tooling. | `ledger`, `shared` | A public API: `src/index.ts` exports nothing yet |
| `packages/shared` | Zod schemas shared by web, API and extract: auth, health, products, and the extraction schema sent to models. | nothing | |

The dependency rules (spec section 2, decision 0016) are enforced by lint, and the code keeps them: `api` and `web` import only `shared` so far.

## The extraction pipeline

Spec section 5's stages:

| Stage | Built? | Where | Tests |
| --- | --- | --- | --- |
| 1. Ingest | Partly: the SHA-256 of each file. No upload, email or storage yet | `src/route/route.ts` (`sha256Hex`) | `src/route/route.test.ts` |
| 2. Route | Yes, except UBL. Facturae 3.2, 3.2.1 and 3.2.2 are parsed with no model; text PDFs go as text; scans and photos as images. HEIC is refused with a message | `src/route/` | `src/route/*.test.ts` |
| 3. Extract | Yes. One OpenRouter call, Zod validation, one retry with the errors, then review. Client documents only go to providers that keep nothing | `src/llm/` | `src/llm/*.test.ts` |
| 4. Validate | Yes. Missing values, line totals, lines sum, VAT, total, tax ID checksum, date, duplicate number. The duplicate check takes the known numbers as input, since nothing stores them yet | `src/validation/` | `src/validation/*.test.ts` |
| 5. Match | Not yet | | |
| 6. Review | Not yet. Each result says whether it needs review and why, and nothing shows it to a person | | |
| 7. Post | In the ledger (`postDocument`), not yet wired to extraction | `packages/ledger/src/document.ts` | `packages/ledger/src/document.test.ts` |

Paths in the table are under `packages/extract/` unless they say otherwise.

**Default model and prompt:** Gemini 3.8 Flash with prompt v2, at temperature 0 (decision 0018). They're set in `packages/extract/config/models.json` and read with `defaultExtraction()` (`src/llm/config.ts`). Prompts are versioned files in `packages/extract/prompts/`.

## The eval harness

- **Gold set:** `eval/gold/` has 20 committed documents: synthetic text PDFs, photos, scans and Facturae XML, each with a hand-checked `expected.json` and `meta.json`. `eval/gold/README.md` lists them. Its tests check the set's size, its metadata, that rendered PDFs match their source, and that no image carries metadata.
- **Private set:** client documents, found through `EVAL_PRIVATE_DIR`, never in the repo. Runs over it are started by the repo owner, always with restricted routing, and their results keep no value read.
- **`eval`:** runs a model and prompt over a set, with a spending cap. It writes `eval/results/<date>-<model>-<prompt>[-runN].json` and `.md`, and never overwrites a file (#68). The summary reports the silent error rate first, then the other section 5 metrics, and why any call failed (#64).
- **`eval:compare`:** runs side by side, with totals and ranges across repeated runs, and the documents whose outcome changed (#52, #68).
- **Scoring:** values are compared by meaning, not text, in `src/eval/normalize.ts`. A blank discount and 0% count as the same (decision 0019).

## The ledger

`packages/ledger/README.md` lists its modules and the property tests for each invariant in spec section 4. `src/invariants.test.ts` fails if an invariant loses its test, or if that README lists a test that doesn't exist. The numbers follow decisions 0010 (quantities) and 0015 (money as `bigint`). Costing follows decision 0005.

## Infrastructure

- **Hosting:** Render, Frankfurt (`render.yaml`, decision 0002).
  - **Staging:** web, an API on the free plan, and Postgres. Deployed from every commit on `main` once CI passes.
  - **Production:** web, API, Postgres with point-in-time recovery, and the weekly backup job. Deployed from a `v*` tag by `.github/workflows/deploy-production.yml`.
- **Database changes:** Drizzle migrations in `apps/api/drizzle/`, applied before each deploy takes traffic (decision 0004).
- **Monitoring:** Sentry for errors in both apps and an uptime check on production's `/health` (decision 0008).
- **Backups:** Render's point-in-time recovery, plus a weekly encrypted dump to Scaleway (`ops/backup/`, decision 0014). How to restore, and the drill record: `docs/runbooks/restore.md`.
- **CI** (`.github/workflows/ci.yml`), on every pull request and on `main`:
  - checks: no git-ignored file tracked, a secret scan, lint, format and typecheck;
  - tests, with Postgres;
  - database: that the migrations match the schema and apply to a fresh database, and the seed;
  - the API starting in production mode;
  - a build, and a backup and restore round trip.

How to run, deploy and operate all this is in the root `README.md`.
