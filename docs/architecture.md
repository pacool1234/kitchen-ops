# Architecture, as built

`docs/spec.md` is the plan. This page is what exists on `main`, checked against the code on 2026-10-20. Where the two differ, this page says "not yet". The reasons behind each part are in `docs/decisions/`.

## The picture today

```
apps/web (Vue 3 PWA) ──► apps/api (Fastify on Render) ──► Render Postgres (EU, PITR), with the job queue (pg-boss)
                                   │
                                   ├──► Scaleway Object Storage   documents' files (decision 0029)
                                   ├──► packages/ledger   converts the catalogue's packs; doesn't post movements yet
                                   └──► packages/extract  reads documents in a background job (decision 0030)

packages/extract ──► packages/ledger (line totals, unit costs: decision 0016)
                 └─► LLM via OpenRouter: the API's job, and the eval command

ops/backup (Render cron, weekly) ──► Scaleway Object Storage (encrypted DB dumps)
```

The plan's other arrow isn't built yet: the API posting through `ledger`. Staging and production each have their own documents' bucket and OpenRouter key: `render.yaml` names the bucket, and the keys are entered in Render's dashboard (README, "One-time setup").

## Apps and packages

| Part | What it does today | Depends on | Not yet |
| --- | --- | --- | --- |
| `apps/web` | Sign-in, owner 2FA setup, a home page, and the catalogue (M5): products with their purchase units, suppliers with their tax IDs checked as typed and their supplier products, and storerooms. Each is listed (searched as typed, filtered, a page at a time, cards on a phone) and read by every role; office and owner create, edit and deactivate them, each field checked by the shared schemas, with unsaved changes warned about (decision 0027). Documents (M6), for every role: uploaded as photos taken in order on a phone, or as a PDF or Facturae file chosen or dropped on a desktop, checked by the API's rules before sending, a file already received refused with a link to the document that has it. A list, filtered by status, and each document's page: its originals, its status, the draft read-only with its failed checks in words, a retry for a failed one, and the reading cost for the owner only. The list and a document's page ask again every 2 seconds while a document is queued or being read, and not otherwise. All in a frame with navigation by role (a sidebar on desktops, a bottom bar on phones), a user menu, page titles and breadcrumbs, in Spanish by default or English, chosen per user (decision 0023). Calls the API through the contract (decision 0022). A design system of tokens and components on Reka UI and Tailwind, light and dark, with a component gallery in development builds (decision 0024). Installable PWA; the service worker caches the app, never `/api`. | `shared` | Reviewing documents, counts, stock and reports (M7 to M9) |
| `apps/api` | `GET /health`, Better Auth under `/api/auth/*` with roles and owner 2FA, `GET /api/me`, `PATCH /api/me` (the user's language), the owner's `GET /api/audit-log`, and its OpenAPI document at `GET /api/openapi.json`. The catalogue: storerooms, suppliers (their tax IDs checked), products with their category, default storeroom and unit conversions, and supplier products with their packs, converted to base units by `ledger`. Each is listed (searched ignoring case and accents, filtered, a page at a time), read, created and updated by office and owner (decision 0026). Every refusal answers a code, and one per field for invalid input. Every write goes through `audited()`, which records it in the append-only `audit_log` in the same transaction (decision 0025). Documents (M6): uploaded by any signed-in user as one PDF or Facturae file or up to 10 photos, kept in object storage, a file already received refused, and read back with 5-minute links (decision 0029). Each upload queues a background job, inside the API process, that reads it through `extract`: 3 tries with backoff, then `failed` with a reason code; a failed one can be retried (decision 0030). What it read, the checks it failed, and each try's cost are stored for review. A document's answer has its draft and the checks it failed by name and field, never a check's own message, which may quote the document; its reading cost goes only to the owner (spec section 6). `EXTRACTION_MODEL=fake` reads without OpenRouter, outside production. Tables: `storerooms`, `suppliers`, `products`, `unit_conversions`, `supplier_products`, `documents`, `document_files`, `extraction_attempts`, `audit_log` and the auth tables, whose `users` hold each user's role and language (`apps/api/src/db/schema.ts`); pg-boss keeps its own in the `pgboss` schema. | `shared`, `ledger`, `extract` | Reviewing documents (M7); movements and stock: posting through `ledger` |
| `packages/ledger` | Movements, unit conversions, posting and reversing documents, weighted-average cost, latest purchase price, yields, variance. Pure: no I/O, no runtime dependencies. | nothing | Nothing stores its results yet |
| `packages/extract` | Routing, LLM extraction, validation, and the eval harness, with the gold set's tooling. Its public API (`src/index.ts`): reading a document's files, one or several photos in order; the checks; the default model; the OpenRouter client. The API's job uses it. | `ledger`, `shared` | |
| `packages/shared` | Zod schemas shared by web, API and extract: auth, health, products, storerooms, suppliers, lists, errors, the languages, the Spanish tax ID check, and the extraction schema sent to models. The API contract: every endpoint, declared once (decision 0022). | nothing | |

The dependency rules (spec section 2, decision 0016) are enforced by lint, and the code keeps them: `web` imports only `shared`, and `api` imports `shared`, `ledger` and `extract`.

## The extraction pipeline

Spec section 5's stages:

| Stage | Built? | Where | Tests |
| --- | --- | --- | --- |
| 1. Ingest | Partly: uploads through the API, kept in object storage, a file already received caught by its SHA-256. No email yet | `apps/api/src/documents/` | `apps/api/src/documents/*.test.ts` |
| 2. Route | Yes, except UBL. Facturae 3.2, 3.2.1 and 3.2.2 are parsed with no model; text PDFs go as text; scans and photos as images. HEIC is refused with a message | `src/route/` | `src/route/*.test.ts` |
| 3. Extract | Yes. One OpenRouter call, Zod validation, one retry with the errors, then review. Client documents only go to providers that keep nothing | `src/llm/` | `src/llm/*.test.ts` |
| 4. Validate | Yes. Missing values, line totals, lines sum, VAT, total, tax ID checksum, date, duplicate number. The API's job gives the duplicate check the numbers already received from that supplier | `src/validation/`, `apps/api/src/extraction/read.ts` | `src/validation/*.test.ts`, `apps/api/src/extraction/*.test.ts` |
| 5. Match | Partly: the supplier, by tax ID. Lines not yet | `apps/api/src/extraction/read.ts` | `apps/api/src/extraction/extraction.test.ts` |
| 6. Review | Not yet. Each document is stored ready for review with its draft and the checks it failed, and nothing shows it to a person (M7) | | |
| 7. Post | In the ledger (`postDocument`), not yet wired to extraction | `packages/ledger/src/document.ts` | `packages/ledger/src/document.test.ts` |

Paths in the table are under `packages/extract/` unless they say otherwise.

**Default model and prompt:** Gemini 3.8 Flash with prompt v2 (decision 0018), at the provider's own temperature: the only zero-retention endpoints don't take one (decision 0031). They're set in `packages/extract/config/models.json` and read with `defaultExtraction()` (`src/llm/config.ts`). Prompts are versioned files in `packages/extract/prompts/`.

## The eval harness

- **Gold set:** `eval/gold/` has 20 committed documents: synthetic text PDFs, photos, scans and Facturae XML, each with a hand-checked `expected.json` and `meta.json`. `eval/gold/README.md` lists them. Runs over it use client routing, so they measure the endpoints staging and production reach (decision 0031). Its tests check the set's size, its metadata, that rendered PDFs match their source, and that no image carries metadata.
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
