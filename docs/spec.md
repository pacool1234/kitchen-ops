# kitchen-ops — Technical Spec (v0.2)

Status: master copy as of 18 Oct 2026. This file is the source of truth; the Claude Doc it was exported from is a historical copy of v0.1.

A pre-employment repo of reusable building blocks for restaurant purchasing and stock control: a deployed skeleton, a stock ledger library and a document-extraction pipeline. Anything marked **Hypothesis** waits for the November discovery session.

Phase 1 (sections 1–10, milestones M0–M4) is done and tagged `pre-employment-v1`. Phase 2 (section 11, M5–M10) builds a working app on top of it, on stated assumptions instead of waiting for discovery.

## 1. Purpose and scope

Build, before any employment starts, the parts of a restaurant purchasing and stock system that hold regardless of one client's specifics. Learn the operations stack along the way.

**In scope**

- A walking skeleton: web app + API + database, deployed to staging and production, with CI, migrations, auth and monitoring
- `packages/ledger`: stock movements, unit conversions, yields, costing and variance, as a pure library
- `packages/extract`: supplier invoice and delivery-note extraction, with an evaluation harness

**Non-goals**

- Issuing invoices or tickets (keeps Verifactu out of scope)
- Accounting: ledgers, VAT returns, payments
- Replacing the POS; sales are imported, never recorded here
- Any client-specific workflow, branding or data

**Status labels used in this spec**

- **Decided:** settled; change only with a written reason (add a record in `docs/decisions/`)
- **Proposed:** default choice, revisit once before building on it
- **Hypothesis:** depends on how the client works; validate in discovery
- **Assumed:** a Hypothesis answered without discovery so that phase 2 can be built (section 11.1). Revisit if a real client works differently

## 2. Architecture

```
apps/web (Vue 3 PWA) ──► apps/api (Fastify on Render) ──► Render Postgres (EU, PITR)
                                   │                  └─► Scaleway Object Storage (photos, PDFs, DB dumps)
                                   ├─► packages/ledger  (pure TS, test-first)
                                   └─► packages/extract (pipeline + eval) ──► LLM via OpenRouter (restricted routing)
```

The API is the only writer to the database. Domain rules live in `packages/ledger`, which has no I/O, so it can be tested exhaustively without a database.

**Repo layout**

```
kitchen-ops/
├── apps/
│   ├── web/          # Vue 3 PWA
│   └── api/          # HTTP API, auth, persistence
├── packages/
│   ├── ledger/       # pure domain logic, no I/O
│   ├── extract/      # document → structured lines, eval harness
│   └── shared/       # Zod schemas and types for web and api
├── eval/
│   ├── gold/         # committed: own/public samples + expected JSON
│   └── private/      # git-ignored: client samples, never committed
└── .github/workflows/
```

**Dependency rules (Decided):** `ledger` depends on nothing; `extract` depends on `ledger` and `shared` (decision 0016); `api` depends on `ledger`, `extract` and `shared`; `web` depends only on `shared`. A lint rule enforces this.

**Stack**

| Layer | Choice | Status |
| --- | --- | --- |
| Frontend | Vue 3 + Vite + TypeScript, installable PWA | Decided |
| API | Node + TypeScript, Fastify (built-in structured logging via pino) | Decided |
| Database | PostgreSQL on Render, EU region, point-in-time recovery | Decided |
| Schema and migrations | Drizzle (schema in TypeScript, generated migrations reviewed in each PR) | Decided |
| Validation and shared types | Zod schemas in `packages/shared`, wired into Fastify through a Zod type provider | Decided: in use since M1 (`apps/api/src/app.ts`) |
| Tests | Vitest + fast-check for property-based tests | Decided: in use since M0 (`pnpm-workspace.yaml` catalog) |
| Monorepo | pnpm workspaces | Decided: in use since M0 (`pnpm-workspace.yaml`) |
| Auth | Better Auth, with roles and 2FA | Decided |
| Hosting | Render, all services in one EU region | Decided |
| Object storage | Scaleway Object Storage, EU region, versioning on | Decided |
| LLM access | OpenRouter: cheap models, plus a frontier model as accuracy ceiling | Decided |
| Error tracking and uptime | Sentry, free Developer plan | Decided |
| Runtime | Node 24 LTS (`.node-version`, `engines`) | Decided |

## 3. Domain model

The entities below are a starting hypothesis. The structure of `Movement` is the most stable part; the rest will be reshaped by discovery.

| Entity | Purpose | Key fields | Status |
| --- | --- | --- | --- |
| Product | A stock item or ingredient | name, base unit (g, ml or unit), category, default storeroom, active | Hypothesis |
| UnitConversion | Purchase units to base unit, per product | product, unit name, factor (e.g. box → 6000 g) | Decided |
| Supplier | Who sells to them | name, tax ID, contact | Decided |
| SupplierProduct | How a supplier names and packs a product | supplier, supplier code, description, pack size, product | Decided |
| Storeroom | Physical location of stock | name, type (cold room, dry store, bar) | Hypothesis |
| Document | Source of every change | type (delivery note, invoice, count, waste, transfer, sales import), date, number, supplier, file, status (draft, review, posted) | Decided |
| DocumentLine | One line of a document | document, product, quantity + unit, unit price, discount, VAT rate | Decided |
| Movement | Append-only stock change | product, storeroom, signed quantity in base unit, unit cost, document line, kind, reverses | Decided |
| Recipe | Expected ingredient use per dish | POS product code, portions, lines (product, quantity, yield) | Hypothesis |
| SaleLine | Imported POS sales | POS product code, quantity, date | Hypothesis |
| CountSession | A physical stock count | storeroom, date, counted lines, counted by | Decided |

**Assumption to validate:** stock moves when goods physically arrive, so movements come from delivery notes; invoices confirm or correct the price. If they only receive invoices, invoices create movements directly.

## 4. Ledger rules (`packages/ledger`)

**Numeric representation (Decided)**

- Quantities are integers in the smallest base unit: grams, millilitres, or thousandths of a unit for counted items
- Money totals are integer cents; unit costs are decimals with 6 places (`numeric(18,6)` in Postgres, `bigint` millionths in TypeScript; decision 0015). JavaScript `number` is never used for money
- Rounding happens only at defined points (line totals, received and average unit costs, yields, variance values; listed in decision 0015), half away from zero, with the rule covered by tests
- Costs exclude VAT (recoverable for the business)

**Invariants (Decided)**

1. Stock on hand is the sum of movements. Any cached balance must be rebuildable from movements and is checked against them.
2. Every movement references a posted document line.
3. Movements are never updated or deleted. A correction is a reversing movement plus a new one.
4. Posting is atomic: a document posts all its movements or none.
5. Replaying the same movements in the same order always gives the same stock and cost.
6. Negative stock is only possible through a flagged adjustment, which reports surface.
7. Posted documents are immutable; changing one means reversing it and posting a corrected version.

**Costing: weighted average (Decided)**

- Received unit cost = line total after discount ÷ quantity in base unit
- New average = (stock × current average + received quantity × received unit cost) ÷ (stock + received quantity)
- If stock is zero or negative before the receipt, the new average is the received unit cost
- Corrections are handled by replaying movements and recomputing

FIFO was rejected: it needs cost layers per delivery, backdated documents reshuffle every later layer, and its "oldest used first" assumption can't be verified in a kitchen.

**Recipe costing (Decided):** dish costs use each ingredient's **latest purchase price**, not the average. Stock valuation answers "what is my stock worth"; recipe costing answers "what does this dish cost to make today."

**Yields (Hypothesis)**

Recipe quantities are net (usable). Gross quantity drawn from stock = net ÷ yield, e.g. 150 g of fish at 60% yield draws 250 g.

**Variance, per product and period (Decided)**

- Actual use = opening count + received + transfers in − transfers out − closing count
- Theoretical use = Σ (dishes sold × gross recipe quantity)
- Unexplained variance = actual use − theoretical use − recorded waste
- Variance value = unexplained variance × average unit cost

The main report lists products sorted by variance value: the owner's answer to "where am I losing money?"

## 5. Extraction pipeline (`packages/extract`)

**Stages (Decided)**

1. **Ingest.** Upload, email attachment or phone photo. Store the original in object storage; hash it to catch duplicates.
2. **Route.** Structured e-invoices (Facturae XML, UBL) are parsed directly. Text PDFs go to text extraction plus an LLM. Images and scans go to a vision-capable LLM.
3. **Extract.** The LLM returns JSON validated against a Zod schema (header + lines). Invalid output is retried once, then sent to review.
4. **Validate.** Line totals, document sum and VAT add up; supplier tax ID passes its checksum; date is plausible; document number isn't a duplicate for that supplier.
5. **Match.** Supplier by tax ID. Lines to `SupplierProduct` by supplier code, then exact description, then an LLM-proposed match. A human confirms each new mapping once; it's remembered.
6. **Review.** Anything failing validation or below a confidence threshold goes to a review queue, shown next to the original document.
7. **Post.** A confirmed document becomes movements through `packages/ledger`.

**Evaluation harness (Decided)**

- `eval/gold/`: committed sample documents with hand-written expected JSON. `eval/private/`: client samples, git-ignored.
- One command runs a model and prompt combination against a set and writes a results file plus a Markdown summary. Results are committed so runs can be compared over time.
- **Models (Decided):** accessed through OpenRouter. Each run compares several cheap models against one frontier model, which sets the accuracy ceiling.
- **Client documents (Decided):** run only with OpenRouter routing restricted to providers that neither train on nor retain the data. Own and public samples have no restriction.
- Structured-output support varies by model and provider; the Zod validation and single retry absorb this, and the failure rate is recorded per model.

| Metric | What it tells you |
| --- | --- |
| Silent error rate | Documents that pass validation but are wrong. The metric that matters most |
| Review rate | Share of documents a human must check |
| Header field accuracy | Supplier, tax ID, date, number, totals |
| Line precision and recall | Lines found vs lines that exist |
| Line field accuracy | Quantity, unit, price, VAT within matched lines |
| Cost per document | Model spend |
| Latency (p50, p95) | Time from upload to review-ready |

**Provisional targets (Hypothesis):** silent error rate below 1% of documents; review rate below 20%. Agree real thresholds with the owner: a reviewed document costs staff time, a silent error corrupts the stock figures.

## 6. Roles and permissions

Three roles to start (Hypothesis: the split depends on who does what). Permissions are enforced by the API; the UI only hides what a role can't do.

| Action | Counter | Office | Owner |
| --- | --- | --- | --- |
| Record a stock count | ✓ | ✓ | ✓ |
| Receive a delivery (photo, confirm quantities) | ✓ | ✓ | ✓ |
| Record waste | ✓ | ✓ | ✓ |
| Review and post supplier invoices | — | ✓ | ✓ |
| Confirm supplier-to-product mappings | — | ✓ | ✓ |
| Edit products, units and recipes | — | ✓ | ✓ |
| Reverse a posted document | — | — | ✓ |
| View cost and variance reports | — | — | ✓ |
| Manage users and roles | — | — | ✓ |

Every write is recorded in an audit log: who, what, when, and from which document.

## 7. Infrastructure and operations

**Hosting: Render, all services in one EU region (Decided)**

| Component | Render service | Production | Staging |
| --- | --- | --- | --- |
| `apps/web` | Static site | Free | Free |
| `apps/api` | Web service, smallest always-on instance | ~$7/month | Suspended when idle |
| Extraction jobs | Background worker | ~$7/month | Suspended when idle |
| Database | Render Postgres, paid instance (point-in-time recovery) | From ~$6/month, sized up as needed | Smallest instance |

For now, extraction jobs run inside the API process instead of their own worker (decision 0030).

Render prices as checked in October 2026; confirm before subscribing. A solo workspace is enough pre-employment; the employer may need a paid workspace once several people need access.

**Environments (Decided)**

- **Local:** Postgres in Docker, seeded with fake data
- **Staging:** deployed on every merge to `main`; suspended when idle
- **Production:** deployed from a tagged release after staging checks pass

**CI pipeline (Decided)**, on every pull request: install → lint (including the dependency rules) → typecheck → unit and property tests → Drizzle migrations applied to a throwaway database → build. Generated migration SQL is reviewed in the PR. Deploy only if every step passes.

**Data (Decided)**

- Render Postgres with point-in-time recovery
- Files (delivery-note photos, invoice PDFs) in Scaleway Object Storage, EU region, versioning on. Render's own object storage is in early access only, and a second provider is needed anyway for the independent copy
- Weekly encrypted database dump to a separate Scaleway bucket: the independent copy outside Render
- A restore into a scratch database every quarter, recorded with date and result

**Auth: Better Auth (Decided)**, with sessions stored in Postgres through its Drizzle adapter, roles from section 6, and 2FA required for owner accounts. No custom password handling.

**Monitoring: Sentry (Decided)**, free Developer plan: error tracking on web and API, plus a Sentry uptime monitor with alerts to your phone. Structured logs on Render, searchable by request and user. Move to the Team plan when more than one person needs access.

**Secrets (Decided):** in Render environment variables and a password manager; never in the repo. A secret-scanning check runs in CI.

**Budget (Decided):** up to €30/month while pre-employment, covering Render, object storage and OpenRouter usage, with a billing alert on every provider.

## 8. Data handling and IP rules

- The repo is generic: no client name, branding or client-specific workflows
- Client documents live only in `eval/private/`, which is git-ignored, and are deleted if the engagement doesn't go ahead
- Committed samples are your own documents, public samples, or synthetic ones
- Seed and test data are synthetic; no real supplier contacts
- Before the first day of employment, tag the repo `pre-employment-v1` as a dated record of pre-existing work
- Ask for a written note that this code is pre-existing work, with the employer receiving a perpetual, free licence to use it
- From day one of employment, client-specific work happens in the employer's GitHub organization

## 9. Milestones

| Milestone | Done when |
| --- | --- |
| M0. Repo and CI | Monorepo builds; lint, typecheck and tests run in CI; dependency rules enforced |
| M1. Walking skeleton | Web and API deployed to staging and production; managed Postgres with migrations; login with roles; error tracking and uptime alerts live; one restore performed |
| M2. Ledger core | Movements, conversions, yields, weighted-average cost and variance implemented; all invariants in section 4 covered by property-based tests |
| M3. Extraction v1 | 20–30 gold documents; pipeline produces validated JSON; eval run reports every metric in section 5 for at least two models or prompts |
| M4. Pre-employment tag | README and architecture notes current; repo tagged `pre-employment-v1` |

Timebox: if M1 isn't done within about two weekends, simplify the infrastructure rather than polishing it.

Phase 2 (section 11.4 has the details; each milestone also meets the quality bar in 11.2):

| Milestone | Done when |
| --- | --- |
| M5. Catalogue and foundations | Products, conversions, storerooms, suppliers and supplier products editable in Spanish on desktop and phone; design system, i18n, audit log; Playwright and axe in CI |
| M6. Document intake | A phone photo or a PDF becomes a draft through a background extraction job, with live status, duplicate detection and recorded cost |
| M7. Review and post | A delivery note goes from photo to stock with only corrections typed; invoices correct prices; stored movements agree with `packages/ledger` |
| M8. Stock, counts, waste and transfers | Stock per storeroom with its value; offline counts sync exactly once; waste and transfers recorded |
| M9. Recipes, sales and variance | A month of demo sales and counts produces a traceable variance report and an owner's dashboard |
| M10. Version 1.0 | `v1.0.0` in production; a demo restaurant on staging; each role's main task done from the user guide without help |

## 10. Open questions for discovery

No technical decisions remain open (see `docs/decisions/`). These answers from the November session can still change this spec. Until then, phase 2 builds on the assumed answers in section 11.1:

| Question | What it changes |
| --- | --- |
| Do suppliers send delivery notes, or only invoices? | Which document creates movements (section 3) |
| How many storerooms and locations; do they transfer stock? | Storeroom model, transfer documents |
| Do written recipes with quantities exist? | Whether variance is possible from day one |
| Can the POS export sales by product line? | SaleLine import, theoretical use |
| Who counts, receives and enters invoices? | Roles (section 6) |
| Is there connectivity in storerooms and cold rooms? | Offline counting in the PWA |
| Which units and packs do staff think in? | UnitConversion design, counting UI |
| How do they weigh review time against errors? | Extraction thresholds (section 5) |

## 11. Phase 2: a working app (Proposed)

Phase 1 (M0–M4, tagged `pre-employment-v1`) built the parts that hold for any restaurant: the deployed skeleton, the ledger and the extraction pipeline. Nothing connects them to a person yet.

Phase 2 builds the app people use every day. A delivery arrives, someone photographs the delivery note, the office checks what was read, and stock and costs update. Staff count stock on their phones, and the owner sees where money is lost.

This is a practice project, so phase 2 doesn't wait for discovery. It goes ahead on the stated assumptions below, chosen to make the app realistic and to teach the most (decision 0020). The repo stays generic (section 8). The restaurant below is fictional, and production holds only synthetic or own data.

### 11.1 Assumptions in place of discovery (Assumed)

| Question (section 10) | Assumed answer | What it makes us build |
| --- | --- | --- |
| Delivery notes, or only invoices? | **Most suppliers** bring a delivery note with the goods and send an invoice later, per delivery or monthly. **A few** send only an invoice. | Delivery notes create movements on receipt (as section 3 assumes). Invoices are matched to their delivery notes and correct the price. An invoice-only supplier's invoice creates movements itself |
| Storerooms, and transfers? | Three: a cold room, a dry store and the bar. The bar takes drinks from the dry store | Stock per storeroom, and transfer documents |
| Written recipes? | Yes, for about 30 dishes, with quantities | Recipe costing, and variance from the first full month |
| POS export? | A daily CSV of sales by product line | Sales import, mapping POS codes to recipes, theoretical use |
| Who does what? | Kitchen and bar staff receive deliveries and count on their phones. An office person enters invoices and fixes mappings. The owner reads reports | Roles as in section 6, with phone-first screens for the counter role |
| Signal in storerooms? | None in the cold room | Counting works offline and syncs when back online |
| Units staff think in | Packs: cases, bottles, kg, bunches | Counting and receiving in purchase units, converted to base units |
| Review time against errors | Errors cost more: a wrong cost misleads for months | Anything that fails a check goes to review, and so does a new supplier's first documents |

**The restaurant we design for:**
- one business, about 10 users and 40 suppliers;
- about 400 products and 300 supplier documents a month;
- the interface in Spanish (es-ES), with English as a second language.

### 11.2 The quality bar (every phase 2 milestone)

The aim is an app that feels professional: fast, consistent, easy on a phone in a cold room, and trustworthy with money.

- **Designed, not assembled:**
  - one design system: tokens, components and spacing, used everywhere;
  - empty, loading and error states for every screen;
  - mobile-first for counter tasks, desktop-first for the office and owner.
- **Accessible:** WCAG 2.2 AA. Automated checks (axe) run in CI on every screen, and every flow works with a keyboard.
- **Spanish first:** every string goes through i18n. Dates, numbers and money are in Spanish format (`1.234,56 €`).
- **Tested end to end:** each milestone's core flow has a browser test (Playwright) against the real API and Postgres in CI, alongside unit and property tests.
- **Trustworthy writes:**
  - every write goes through the API, inside a transaction where it touches stock;
  - every write is in the audit log (section 6);
  - posting keeps the ledger's invariants. Database-level property tests check that stored movements rebuild the same stock and cost as `packages/ledger`.
- **Fast:** a performance budget per screen, checked in CI. Lists of hundreds of products stay instant.
- **Observable:** structured logs per request and job. Sentry on every app and worker, including background jobs.
- **Explained:**
  - each technical choice has a decision record before it's built on;
  - each milestone updates `docs/architecture.md`;
  - a short user guide covers each role.
- **Demonstrable:** staging runs a demo restaurant with synthetic data: suppliers, documents, recipes and a month of sales. It is reset nightly.

### 11.3 Choices to make (Proposed)

Each is settled by a decision record at the start of the milestone that first needs it.

| Choice | Default to try | First needed |
| --- | --- | --- |
| Component library and styling | A headless component library with Tailwind CSS, and our own design tokens | M5 |
| Internationalisation | vue-i18n | M5 |
| Browser tests | Playwright, with axe for accessibility | M5 |
| API contract | OpenAPI generated from the Zod schemas, and a typed client in the web app | M5 |
| Background jobs | A Postgres-backed queue (pg-boss): no extra service. Runs in the extraction worker from section 7 | M6 |
| File storage | Scaleway Object Storage (section 7), with uploads and downloads through short-lived signed URLs | M6 |
| Offline data | IndexedDB, with a queue of writes synced through idempotent API calls | M8 |
| Charts | A small, accessible chart library for reports | M9 |

### 11.4 Milestones

**M5. Catalogue and foundations**
- **The foundations:** the design system, i18n, Playwright and axe in CI, the OpenAPI client, and the audit log.
- **The catalogue:**
  - products, with base unit, category, default storeroom and active;
  - unit conversions per product, storerooms, and suppliers with their tax ID checked;
  - supplier products: a supplier's code, description and pack, mapped to one of our products.
- **Done when:** an office user can create and edit all of these in Spanish, with validation messages, on desktop and phone. Every write is in the audit log. The flow passes in Playwright and axe, and the catalogue has a searchable, paginated list.

**M6. Document intake**
- **Getting a document in:**
  - upload a PDF or Facturae file on desktop, or take one or several photos on a phone;
  - the original goes to object storage, and a document whose file hash is already known is caught as a duplicate.
- **Reading it:**
  - extraction runs as a background job with retries, using the default model and client-safe routing (section 5);
  - its status (queued, reading, ready for review, failed) shows live in the app;
  - each document's model cost is recorded.
- **Done when:**
  - a phone photo becomes a readable draft, and the app shows its progress;
  - a failed job can be retried from the app;
  - Playwright covers the flow, with a fake model in CI.

**M7. Review and post**
- **The review screen:** the original document next to the fields read.
  - Failed checks are highlighted, and lines are editable.
  - The supplier is found by tax ID, or created on the spot.
- **Mapping lines to products:** by supplier code, then description, then a suggestion from a model. Each mapping is confirmed once and remembered.
- **Posting:** through `packages/ledger`, atomically, into append-only movements.
- **Invoices:** matched to their delivery notes, with price differences shown and posted as cost corrections.
- **Reversing:** owners can reverse a posted document.
- **Done when:**
  - a delivery note goes from photo to stock with no data typed except corrections;
  - an invoice corrects the prices of its delivery notes;
  - database-level property tests show stored movements and `packages/ledger` agree on stock and cost;
  - every step is in the audit log.

**M8. Stock, counts, waste and transfers**
- **Stock:** on hand per product and storeroom, valued at average cost, with the movements behind it.
- **Counting:** sessions on a phone that work offline and sync exactly once.
- **Waste and transfers:** recording waste with a reason, and moving stock between storerooms.
- **Done when:**
  - a count made with the network off syncs correctly when it's back, even if sent twice;
  - stock and value match the ledger;
  - the counting flow is quick with one hand.

**M9. Recipes, sales and variance**
- **Recipes:** with yields, and costed at each ingredient's latest price.
- **Sales:** a daily POS CSV import, mapping POS codes to recipes, and re-importing a day doesn't double it.
- **Variance:** the report per product and period, sorted by money lost. An owner's dashboard shows stock value, the last purchases, the biggest variances and food cost against sales.
- **Done when:** a month of demo sales and counts produces a variance report the owner can act on, and every figure can be traced to its documents.

**M10. Version 1.0**
- **Polish:** a pass on performance, accessibility and copy over every screen.
- **The demo restaurant** on staging, reset nightly, and a short guided first run for each role.
- **Before release:** the user guide, and a security review (auth, permissions per role, file access, rate limits).
- **Done when:** a release tagged `v1.0.0` runs in production. Someone new can sign in to the demo, follow the guide and complete each role's main task without help.

### 11.5 Out of scope for phase 2

- More than one business per installation (multi-tenancy).
- Ordering from suppliers.
- Native mobile apps: the PWA covers phones.
- The non-goals in section 1 still hold: no invoices or tickets issued, no accounting, no POS.

**Budget:** the background worker adds about $7 a month in production (section 7). About 300 documents a month cost about $4 in model calls (decisions 0018 and 0031). Both fit the €30 budget, checked again at M6.
