# 0028. Staging's demo: seeded once on its first start, kept, with logins of its own

- Status: Accepted
- Date: 2026-10-19

## Context

Staging gets every merge to `main`, but until now it had no accounts and no data: the seed never ran on Render, and the app has no screen for managing users yet. Nobody could sign in to try what a milestone delivers.

Spec 11.2 ("Demonstrable") proposes a demo restaurant on staging, reset nightly. A nightly reset suits a staging that strangers try with published logins: it undoes whatever they did. This staging is for the owner's own tries, built up over days, so a reset would throw away work. Spec section 11 is Proposed, so this record changes no Decided item.

The staging database accepts connections only from Render's own services, and the free staging API has no shell or pre-deploy command. Anything that writes to it has to run in the API's own start command, as the migrations already do.

## Decision

**The seed runs on every start of the staging API,** between the migrations and the server (`render.yaml`).
- Each table is filled only if it's empty, so the first start seeds the database and every later one changes nothing. Whatever was created since is kept. There's no nightly reset.

**It runs only when asked for in so many words:** `SEED_DEMO=true`, set on the staging API alone (`planSeed`, `apps/api/src/db/seed-plan.ts`).
- Without it, the seed refuses in production, as before. Production has no `SEED_DEMO`, so it's never seeded.
- Any other value ("1", "yes") counts as unset.
- A test checks that `render.yaml` sets the demo's variables on the staging API and nowhere else.

**Staging has its own logins:** one per role (counter, office, owner), on the same addresses as locally (`office@example.test`).
- Their passwords come from `DEMO_PASSWORD_COUNTER`, `DEMO_PASSWORD_OFFICE` and `DEMO_PASSWORD_OWNER`. They are entered in Render's dashboard (`sync: false`), never written in the repo, and must be at least 12 characters, since staging is on a public URL.
- If one is missing or too short, the seed refuses, naming it, and the API doesn't start: a loud failure in Render's log rather than a half-seeded staging.
- The local-only passwords in the README don't work on staging.
- The owner, like every owner, sets up 2FA on the first sign-in.

**The data is the same fictional restaurant as locally** (`seed-catalogue.ts`): synthetic, with no real supplier, client or staff data (spec section 8).

## Alternatives considered

- **A nightly reset (spec 11.2):** right for a demo shown to others with published logins; wrong for the owner's own tries, which it would erase.
- **Seeding from a laptop against staging's database:** the database accepts no connections from the internet, and opening it up for this isn't worth the exposure.
- **The local-only logins on staging:** their passwords are in the README, on a public URL.
- **Separate addresses for staging's logins:** one more thing to remember, for no gain once the passwords differ.
- **Seeding only on the first deploy:** the free plan has no way to run something once; the start command with tables skipped when they have rows does the same.
