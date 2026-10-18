# 0020. Phase 2: a working app, built on stated assumptions

- Status: Accepted
- Date: 2026-10-18

## Context

Phase 1 (M0–M4) is done and tagged `pre-employment-v1`. Its scope was deliberately the parts that hold for any restaurant: the deployed skeleton, the stock ledger and the extraction pipeline. Nothing connects them to a person: the API serves sign-in and a list of products, and the web app shows little more (`docs/architecture.md`).

The rest of the app depends on how a restaurant works, which section 10 of the spec leaves to a discovery session. For example: do suppliers send delivery notes, who receives the goods, is there signal in the cold room? But this is a practice project. Waiting would leave the most instructive part of the system unbuilt: the screens, background jobs, files, offline use, and posting to a real database.

## Decision

**Build phase 2, a working app, now, on stated assumptions** (spec section 11):
- The assumed answers to each discovery question are written down and labelled **Assumed** (section 11.1). Where there was a choice, they were picked to make the app realistic and to teach the most: delivery notes reconciled with invoices, three storerooms with transfers, offline counting, a daily POS import.
- **A quality bar applies to every milestone** (section 11.2). It covers the design system, accessibility, Spanish-first i18n, browser tests in CI, trustworthy writes with an audit log, performance budgets and a demo restaurant. The aim is an app that looks and behaves like a professional product, not a prototype.
- **The technical choices still open are Proposed, with a default each** (section 11.3), and each is settled by its own decision record at the start of the milestone that first needs it.
- **The repo stays generic** (section 8). The restaurant is fictional, and production holds only synthetic or own data.

## Consequences

- If a real client works differently, the Assumed rows show exactly what to revisit. Decided items in the spec are unchanged.
- Phase 2 adds a background worker in production (about $7 a month) and model calls per document. Both fit the €30 budget, rechecked at M6.

## Alternatives considered

- **Wait for discovery.** That's the right call with a real client. Here it would mean weeks without building, for a session that may not happen.
- **Prepare for discovery first,** with an interview guide and a demo of what exists. It teaches less, and a working app makes a far better demo for that session anyway.
- **A thin prototype without the quality bar.** Faster, but it wouldn't teach how a professional app is built and run, which is the point of the project.
