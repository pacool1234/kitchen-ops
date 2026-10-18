# 0025. The audit log: written with each change, kept by a database trigger

- Status: Accepted
- Date: 2026-10-18

## Context

Spec section 6: "Every write is recorded in an audit log: who, what, when, and from which document." Phase 2 adds writes in every milestone, starting with the catalogue (#88). The log must exist before the first of them, and it must be hard to forget and impossible to rewrite.

## Decision

**An `audit_log` table:**
- who (the user), when, and which request (the `x-request-id` header, which is also in the API's logs and in Sentry);
- what: the action (`create`, `update` or `delete` for now), and the entity's type and ID;
- the document behind the change, when there is one;
- the changed fields, each with its value before and after.

**Values are stored as JSON:** amounts in `bigint` as their digits, dates as ISO text. A field named like a password, a secret, a token, a session or an API key keeps only the fact that it changed (`"[redacted]"`).

**Append-only, by a trigger.** It refuses `UPDATE` and `DELETE` on the table, whoever asks and however: the app, a script or raw SQL. `TRUNCATE` stays possible: like `DROP TABLE`, it's the table owner's operation, and tests use it to reset. The trigger is a migration written by hand (`0004_audit_log_append_only.sql`), since Drizzle's schema can't express one.

**One way to write: `audited(db, context, work)`.**
- It runs the work in a transaction.
- The work returns what it changed, as before and after values per entity.
- The helper writes one entry per changed entity in the same transaction. A change that changed nothing records nothing, and if anything fails, nothing is saved.

**Two checks make it hard to forget:**
- **A test lists every write endpoint in the contract** and fails until each has a case showing the entries it records.
- **Lint refuses `db.insert`, `db.update` and `db.delete`** in the API's features. The seed, the database scripts and the tests are exempt.

**The owner reads the log** at `GET /api/audit-log`, filtered by entity, user and time, newest first, one page at a time.

**Better Auth's own writes stay out:** sign-in, sessions and turning on 2FA. They're authentication events, which Better Auth keeps in its sessions table. A sign-in history can come later.

## Alternatives considered

- **Permissions instead of a trigger:** revoke `UPDATE` and `DELETE` from the app's database user. On Render the app connects as the table's owner, which can grant the rights back to itself. The trigger holds whatever role connects.
- **Database triggers that write the log:** one per audited table. They can't be forgotten, but they'd log rows, not the user's action. They'd also need who, the request and the document passed into every transaction (`SET LOCAL`), and they'd put the logic in SQL, which is harder to test and read.
- **Every field, not only the changed ones:** simpler, but an entry would hide its one change among the unchanged fields, and the log would grow with every write's full row.
