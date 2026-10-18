# 0022. The API contract: endpoints declared once in `shared`, and a generated OpenAPI document

- Status: Accepted
- Date: 2026-10-18

## Context

Every phase 2 screen talks to new API routes (spec section 11). The Zod schemas in `packages/shared` already describe requests and responses, and the web app validates each response with them. But nothing links a route to its schemas: the API registers `/api/products` with `ProductList`, the web app calls `/api/products` and validates with `ProductList`, and the two are matched by hand. Nothing describes the API to anyone outside the code either.

Spec section 11.3 proposed OpenAPI generated from the Zod schemas, and a typed client generated from that.

## Decision

**Each endpoint is declared once, in `packages/shared/src/contract.ts`:** its method, path, parameters, query, body, response, and who may call it (anyone, any signed-in user, or some roles). Both sides are built from that declaration:
- **The API** registers each route from its contract entry. Its URL, Zod schemas and role check can't drift from the contract, and a test refuses any route that isn't in it.
- **The web app** calls `call(endpoint, input)`. Paths, parameters and bodies are typed by the contract, and every response is still validated with the endpoint's schema at runtime.
- **OpenAPI 3.1 is generated from the registered routes** by `@fastify/swagger`, with `fastify-type-provider-zod`'s transform, and served at `GET /api/openapi.json`. Each operation lists who may call it as `x-roles`. The document is also committed as `apps/api/openapi.json`, and CI fails if it's out of date, so every change to the API shows up in review.

Better Auth's own routes (`/api/auth/*`) stay out of the contract and the document: the web app calls them through Better Auth's typed client.

## Alternatives considered

- **A client generated from the OpenAPI document** (openapi-typescript with openapi-fetch). This is the more common pattern, but the generated types only exist at compile time. Validating responses at runtime, which CLAUDE.md asks for all external input, would still need the Zod schemas, so each response would be described twice, and generated code would need regenerating and reviewing.
- **A contract library such as ts-rest.** It's the same idea, but it's a dependency for about 80 lines of our own code, and it puts its own conventions on how routes are registered and called.
- **No contract:** keep matching paths and schemas by hand. Fine for three routes; not for the dozens phase 2 adds.
