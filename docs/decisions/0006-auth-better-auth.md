# 0006. Auth: Better Auth

- Status: Accepted
- Date: 2026-10-14

## Context

A proven library is enough at this scale; no custom password handling. Role and 2FA support confirmed against the spec's role matrix.

## Decision

Better Auth with its Drizzle adapter, sessions in Postgres, 2FA required for owner accounts.

## Alternatives considered

Managed auth service; custom auth.
