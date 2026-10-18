# 0026. The catalogue's API: field-level errors, search, lists and tax IDs

- Status: Accepted
- Date: 2026-10-18

## Context

M5's catalogue (#88) brings the API's first entities that people create, search and edit: storerooms and suppliers, then products, their unit conversions and supplier products. Their screens (#89) need to show each refused field's message next to it, in Spanish, and to search lists of about 400 products as people type. Spec section 11.1 also expects about 40 suppliers, each with a tax ID that must pass its checksum.

## Decision

**Every refusal answers an `ErrorBody`** (`packages/shared/src/errors.ts`), and the contract describes each one in OpenAPI:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_input` | The body, query or path is refused, with `fields`: one code per field, keyed by its path (`taxId`, `lines.1.quantity`) |
| 404 | `not_found` | No row with the ID in the path |
| 409 | `conflict` | A value that must be unique is taken, with `fields`, e.g. `{ "taxId": "taken" }` |

- **The field codes are a closed list** (`FIELD_ERROR_CODES`): `required`, `invalid`, `too_short`, `too_long`, `too_small`, `too_big`, `unknown_field`, `invalid_tax_id` and `taken`. The API maps Zod's issues onto them, and a refinement names its own code with `fieldError(...)`. The web app can then be type-checked for having a message for each.
- **Duplicates are caught by unique indexes,** and the error handler turns Postgres's refusal into a 409. `UNIQUE_FIELDS`, next to the schema, says which field each index guards. Checking first and inserting after would let two requests at the same moment both pass.
- **Anything else stays a 500:** a bug, logged and sent to Sentry.

**Lists** (`packages/shared/src/lists.ts`) take:
- `q`, to search;
- `status`: `active` (the default), `inactive` or `all`;
- filters of their own (a storeroom's type, for example);
- `page` and `pageSize` (50 by default, at most 200).

They answer `{ items, total, page, pageSize }`, where `total` counts every row the filters match.

**Search ignores case and accents,** with Postgres's `unaccent` extension (migration 0006): "limon" finds "Limón". The text means what it says: `%` and `_`, LIKE's wildcards, are escaped. Lists are in Spanish order (the `es-x-icu` collation), so case and accents don't move a name.

**Nothing is deleted.** Every catalogue entity has `active`, and `PATCH { active: false }` deactivates it, since later documents, movements and counts will refer to it. A `PATCH` changes only the fields it's sent, and locks the row while it does.

**Names are unique whatever their case** for storerooms (and products). A supplier's name isn't unique, but its tax ID is.

**Tax IDs:** `checkSpanishTaxId` moves to `packages/shared`.
- It's there so the web app can check a tax ID before sending it. `extract` imports it from `shared`, as the dependency rules allow.
- A tax ID is stored in one form: upper case, without spaces, dots, hyphens or slashes, and without the `ES` prefix. So "es-b00.123.455" and "B00123455" are the same supplier.
- Only Spanish tax IDs (NIF, NIE and CIF) can be checked, so only they are taken for now.

## Alternatives considered

- **Errors as text,** such as Fastify's default `message`: the web app couldn't translate them or place them next to a field.
- **The API calling `extract` for the tax ID check:** within the dependency rules, but the web app, which may only use `shared`, couldn't check before sending.
- **An accent-free copy of each name,** kept by the API, instead of `unaccent`: no extension, but one more column every write must remember to keep in step.
- **`pg_trgm` for fuzzy search:** it finds typos too, but adds ranking to explain and tune. "Contains, ignoring case and accents" is enough for a catalogue of hundreds.
- **Foreign suppliers' VAT numbers,** checked through the EU's VIES service: a network call that can fail. Left for when a foreign supplier appears.
