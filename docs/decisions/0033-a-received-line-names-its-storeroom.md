# 0033. A received line may name its own storeroom

- Status: Accepted
- Date: 2026-10-20
- Extends: spec section 3, `DocumentLine` (Decided), with one optional field.

## Context

A delivery note brings goods for several storerooms at once: tomatoes for the cold room, wine for the bar. Posting it (#119) sends each product to its default storeroom unless someone chooses otherwise. The ledger took a single storeroom per document, so a mixed delivery couldn't be posted as one document.

## Decision

- **A delivery-note or invoice line may name a storeroom** (`storeroomId`). That line's receipt goes there; without it, the document's storeroom is used, as before.
- **An invoice line that bills a delivery-note line ignores it.** Its correction stays where the goods were received (decision 0032).
- **Waste, counts and transfers are unchanged:** one storeroom per document.
- **The stored lines (#116) keep the storeroom each line was received into.**

## Alternatives considered

- **One delivery note split into one document per storeroom.** One supplier document would become several posted ones, and the review screen and the audit log would have to explain the split.
- **A storeroom on every line, required.** That's needless for the common case of a delivery going to one place.
