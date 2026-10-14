# 0003. API framework: Fastify

- Status: Accepted
- Date: 2026-10-14

## Context

Long-running Node server on Render; built-in structured logging (pino) covers a spec requirement; Zod integrates through a type provider; mature ecosystem.

## Decision

Fastify with a Zod type provider.

## Alternatives considered

Hono (close second: typed client for the Vue app, but its run-anywhere strength matters less on Render). Express (dated typing). NestJS (too much structure for one developer).
