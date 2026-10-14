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
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @kitchen-ops/web dev
```

CI runs the same checks, plus a secret scan and a build, on every pull request.

## Docs

- `docs/spec.md`: the spec
- `docs/decisions/`: decision records, with the reasons
