# 0021. Browser tests: Playwright, with axe for accessibility

- Status: Accepted
- Date: 2026-10-18

## Context

Phase 2's quality bar (spec section 11.2) asks for a browser test of each milestone's core flow, against the real API and Postgres in CI, and automated accessibility checks on every screen (WCAG 2.2 AA). Unit tests can't show that a screen works for a person: that the right page loads, a form submits, a role sees what it should, and the page can be used with a keyboard and a screen reader.

## Decision

**Playwright for browser tests, with `@axe-core/playwright` for accessibility.**

- **The tests live in `apps/web/e2e/`,** since they test the web app. Each one drives a real browser against the built app (`vite preview`), the API and a Postgres database of their own.
- **Two sizes:** desktop Chromium, and a phone (Chromium with phone emulation), because counter tasks are phone-first. WebKit (Safari) is added in M10, when the polish pass needs it.
- **axe runs on every page a test visits,** with the WCAG 2.0, 2.1 and 2.2 A and AA rules. Any violation fails the test.
- **Each run starts from a fresh database,** `kitchen_ops_e2e`: dropped, migrated and seeded. Tests never touch development data and can be rerun.
- **The tests' API runs with `NODE_ENV=test`,** not `production`. In production, Better Auth allows 3 sign-ins per 10 seconds from one address. Browser tests sign in more often than that from one machine. Everything else runs the same, and CI still checks separately that the API starts in production mode.
- **In CI, a job of its own,** next to the main one, so it adds no time to it. When a test fails, its trace and screenshots are uploaded.

## Alternatives considered

- **Cypress:** a good runner, but it runs tests inside the browser, which makes phone emulation, several tabs and file downloads harder. Its free tier also runs tests in parallel less easily.
- **Vitest browser mode:** good for testing one component in a real browser, but it doesn't run whole flows across the app, the API and the database.
- **Only manual checks:** they don't scale over six milestones, and they don't stop a regression in a pull request.
