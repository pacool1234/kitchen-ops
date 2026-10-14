# 0011. Primary keys: UUID v7, created by the API

- Status: Accepted
- Date: 2026-10-15

## Context

Every table needs a primary key. Posting a document creates the document, its lines and the movements that reference those lines in one transaction, and `packages/ledger` must stay free of randomness ("time and IDs are passed in as arguments"). Requests from phones on poor connections can be retried, and the PWA may later create records offline.

## Decision

Primary keys are UUID v7. The API creates them with Node's built-in `crypto.randomUUIDv7()` before inserting (Drizzle `$defaultFn`, through the `primaryId()` helper in `apps/api/src/db/schema.ts`), and passes them into ledger functions. A caller may supply an ID, e.g. when retrying a request, and it is kept.

The column also has a database default, `uuidv7()` (Postgres 18), used only by rows inserted by hand in SQL. This requires Postgres 18 locally, in CI and on Render (`postgresMajorVersion: "18"`, which cannot be changed after the database is created).

UUID v7 starts with a millisecond timestamp, so IDs are safe to show in URLs (no row counts revealed) and new rows go to the end of the primary-key index. Within one millisecond the order is random, so nothing may rely on IDs for exact ordering; use `created_at` or an explicit sequence.

## Alternatives considered

- Database-generated only: simpler, but the ledger could not build linked records without a round trip per level, and a retried insert would create a duplicate.
- Integer identity: smaller, but reveals counts and can only be assigned by the database.
- UUID v4: random, so new rows land all over the index.
