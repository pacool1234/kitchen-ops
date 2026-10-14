# 0008. Monitoring: Sentry

- Status: Accepted
- Date: 2026-10-14

## Context

Free Developer plan (5,000 errors/month, one user, includes an uptime monitor) covers this scale. Monitoring must be more reliable than the system it watches.

## Decision

Sentry for web and API errors and uptime. A home-made error tracker is a separate side project and may receive staging errors in parallel, never replace Sentry here.

## Alternatives considered

Building our own error tracker for this system.
