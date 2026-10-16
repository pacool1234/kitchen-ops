# kitchen-ops

Reusable building blocks for restaurant purchasing and stock control: a deployed walking skeleton, a stock ledger library and a supplier-document extraction pipeline. Pre-employment project; the repo stays generic (no client names or data).

Full spec: `docs/spec.md`. Decisions and their reasons: `docs/decisions/`. Read the relevant section before working on a part of the system, not the whole file every time.

## Commands

- Install: `pnpm install` (Node 24, pnpm 10; see `.node-version`)
- All tests: `pnpm test` · all typechecks: `pnpm typecheck` · lint: `pnpm lint`
- One package: `pnpm --filter @kitchen-ops/<name> <script>` (names: web, api, ledger, extract, shared)
- Add a dependency to one package: `pnpm --filter @kitchen-ops/<name> add <dep>`; root-only tooling uses `pnpm add -D -w <dep>`
- Frontend dev server: `pnpm --filter @kitchen-ops/web dev`

## Layout and dependency rules

- `apps/web` Vue 3 PWA · `apps/api` Fastify API · `packages/ledger` pure domain logic · `packages/extract` extraction + eval harness · `packages/shared` Zod schemas and shared types
- `ledger` depends on nothing. `extract` depends on `ledger` and `shared` (decision 0016). `api` may depend on `ledger`, `extract`, `shared`. `web` depends only on `shared`. Never add an import that breaks this, even temporarily.
- Packages reference each other as `"@kitchen-ops/<name>": "workspace:*"`.

## Hard rules

- Never read, copy, quote or commit anything under `eval/private/`. It holds client documents and is git-ignored. A hook blocks commits that touch it; do not work around the hook.
- Never write secrets, API keys or `.env` contents into code, tests, docs or commit messages. Use `process.env` and document the variable name in `.env.example`.
- Money is never a JavaScript `number`: integer cents for totals, a decimal library for unit costs. Quantities are integers in the base unit (g, ml, or thousandths of a unit).
- Stock movements are append-only. Never write code that updates or deletes a movement or a posted document; corrections are reversing movements.
- The system never issues invoices or tickets (Verifactu stays out of scope). If a task seems to require it, stop and ask.
- Do not change a **Decided** item in the spec. If one looks wrong, say so and propose a decision record instead.
- Do not upgrade TypeScript, Vite or other major versions as a side effect of another task.

## How a session works

1. Work comes from a GitHub issue. Start by reading it: `gh issue view <number>`.
2. Before writing code, propose a short plan: files to change, tests to add, anything unclear in the issue. Wait for approval.
3. Work on a branch named `<issue-number>-<short-slug>`. Keep changes inside the issue's scope; note out-of-scope findings as follow-up suggestions instead of fixing them.
4. Tests first for anything in `packages/ledger`. Run `pnpm test` and `pnpm typecheck` before saying a task is done.
5. Finish by opening a PR with `gh pr create`, with `Closes #<number>` in the body and a checklist of the issue's "done when" criteria, each marked met or not met with evidence (command output, test names).
6. "Done" means the criteria pass in CI, not that the code looks finished.

## Style

- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- Validate all external input (HTTP bodies, LLM output, imported files) with Zod schemas from `packages/shared`.
- Small, focused commits with conventional prefixes: `feat:`, `fix:`, `test:`, `chore:`, `docs:`.
- Explain non-obvious decisions in the PR description; the owner of this repo is learning and reads every diff.
- Database changes go through Drizzle schema edits and generated migrations. Paste the generated SQL into the PR description. Never hand-edit an applied migration.
