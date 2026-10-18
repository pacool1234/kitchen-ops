# 0026. The catalogue's API: field-level errors, search, lists, tax IDs, conversions and packs

- Status: Accepted
- Date: 2026-10-18; extended 2026-10-19 with conversions and packs (#88, part 2)

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

**A product's base unit is set when it's created, and never changes.** Stock will be counted in it (M7): changing it would silently rescale every quantity.

**Unit conversions belong to their product.**
- They're sent and answered with it, and a change replaces the list. The audit entry shows `conversions` before and after.
- A factor is a whole number of base units, at most 2³¹ − 1, as `packages/ledger` takes it (decision 0010).
- A unit appears once per product, whatever its case.
- The base unit's own conversion is never stored: the API adds it (1 for g and ml, 1000 for unit), so its name is `reserved`.

**A supplier product's pack is a quantity in one of the product's units:** "6 kg", "0.5 caja", "12 unit".
- The quantity has up to 6 decimals and is at most 100 000, so a pack's base units always fit a safe integer.
- Its base units (`packBaseUnits`) are worked out by the ledger's `toBaseUnits` each time it's read, from the product's current conversions. The catalogue converts exactly as posting will.
- A pack the ledger can't convert to a whole number of base units is refused: `not_whole_base_units`.
- So a product change can't break a pack: removing a conversion a pack uses, or a factor that leaves a pack a fraction of a base unit, answers 409 `in_use`. The product's row is locked while its conversions or a pack change, so the two can't cross.

**A reference to a row that doesn't exist answers 400,** naming the field with `not_found`. Foreign keys catch it, as unique indexes catch duplicates (`FOREIGN_KEY_FIELDS`, next to the schema).

## Alternatives considered

- **Errors as text,** such as Fastify's default `message`: the web app couldn't translate them or place them next to a field.
- **The API calling `extract` for the tax ID check:** within the dependency rules, but the web app, which may only use `shared`, couldn't check before sending.
- **An accent-free copy of each name,** kept by the API, instead of `unaccent`: no extension, but one more column every write must remember to keep in step.
- **`pg_trgm` for fuzzy search:** it finds typos too, but adds ranking to explain and tune. "Contains, ignoring case and accents" is enough for a catalogue of hundreds.
- **Conversions with their own routes** (`/api/products/:id/conversions`): more endpoints to call and to test, for something always edited with its product.
- **A pack as its base units alone** ("6000 g"): simpler, but a change to a box's factor wouldn't carry through, and "6 kg" is what the supplier prints.
- **A free-text or table of categories:** free text splits one category into spelling variants, and a table would be one more thing to manage. A fixed list is translated in the app.
- **Foreign suppliers' VAT numbers,** checked through the EU's VIES service: a network call that can fail. Left for when a foreign supplier appears.
