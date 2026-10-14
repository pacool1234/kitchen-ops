# 0004. Schema and migrations: Drizzle

- Status: Accepted
- Date: 2026-10-14

## Context

Schema lives in TypeScript; migrations are generated, so less boilerplate for a developer new to migrations. Reviewing the generated SQL in each PR still teaches SQL.

## Decision

Drizzle. Generated SQL is pasted into every PR. CI applies migrations to a throwaway database, which catches surprises such as a rename becoming drop + add.

## Alternatives considered

Kysely (more transparent, hand-written migrations, more boilerplate).
