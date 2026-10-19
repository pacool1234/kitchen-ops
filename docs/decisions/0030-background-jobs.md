# 0030. Background jobs: pg-boss, with the worker inside the API for now

- Status: Accepted
- Date: 2026-10-19
- Changes: spec section 7's "Extraction jobs: background worker" row, for now (see below)

## Context

Reading a document takes from seconds to a minute or two, and can fail on a network or provider error. It can't happen inside the upload request (#104). Spec 11.3 proposed a queue kept in Postgres (pg-boss), so there's no other service to run. Spec section 7 decided a Render background worker for extraction jobs, at about $7 a month in production. Render has no free worker, so staging's would cost the same.

The budget is €30 a month in all (spec section 7). About 300 documents a month (spec 11.1) is about ten a day: one at a time is plenty.

## Decision

**pg-boss 12, a queue kept in Postgres,** in its own `pgboss` schema. It creates and migrates that schema itself when it starts; Drizzle doesn't see it.

**The worker runs inside the API process.** It reads one document at a time and starts once the API is ready. When the API stops, it lets the current try finish, for up to 30 seconds. This changes spec section 7's row for now. Moving the worker to its own Render service later only takes a start command that runs the worker without the HTTP server, with no change to the jobs themselves.

**A job is queued in the transaction that saves its document,** through pg-boss's Drizzle adapter: there's never a document without its job, or a job without its document. Retrying a failed document does the same.

**3 tries in all.** After an error, the job is tried again with backoff: the wait starts at about 30 seconds and grows each time, up to 10 minutes.
- **Tried again:**
  - errors from OpenRouter, and the network failing;
  - a call taking more than 3 minutes;
  - the files not fetched from storage;
  - anything unexpected.
- **Not tried again:** a file that can't be read (a broken photo, a PDF with too many pages). It's failed at once.
- **After the last try,** pg-boss moves the job to a dead-letter queue (`read-document-failed`), whose handler marks the document `failed`.
- **A try that never finishes** (the API restarted mid-try) expires after 15 minutes and is tried again. If it was the last try, its document is failed as `interrupted`.

**Statuses:** `queued` → `reading` → `ready_for_review` or `failed`.
- Between tries, a document is `queued` again, so `reading` always means a try is under way.
- A document is ready for review whether its checks pass or not: M7 reviews them.
- A model answer that doesn't match the schema, even after its own retry (spec section 5, stage 3), is ready for review with a note, not failed.

**Failure reasons are codes:** `model_error`, `model_unreachable`, `storage_error`, `unreadable`, `interrupted`, `unexpected`. The app translates them. Neither the document's contents nor a provider's message is ever stored, logged or sent to Sentry.

**Every try is recorded** in `extraction_attempts`: the model, prompt version, tokens, cost in millionths of a dollar, latency and outcome. A document's cost is the sum of its tries.

**The job's writes aren't in the audit log** (decision 0025). No user makes them; the tries are their record. A retry is audited as the user who asked for it.

**On staging, a job waits while the free API sleeps,** and runs when the next request wakes it.

**`EXTRACTION_MODEL=fake`** answers a fixed, hand-written extraction without calling OpenRouter, for development, tests and the browser tests. The API refuses to start with it in production.

**Without a key or the fake model, the API still starts:** uploads wait, queued, until `OPENROUTER_API_KEY` is set (#105).

## Alternatives considered

- **A Render background worker now (spec section 7):** about $7 a month each for staging and production, about half the budget, for about ten documents a day. It's the way to go once reading starts to slow the API down.
- **A queue of our own on a `documents` column:** polling, locks, retries, backoff and expiry would all need writing and testing. pg-boss already does all of these.
- **Redis with BullMQ:** another service to run and pay for, with no gain at this volume.
- **Reading inside the upload request:** a minute-long request on a phone, with nothing to try again when the provider fails.
