# 0010. Quantities are safe-integer numbers

- Status: Accepted
- Date: 2026-10-14

## Context

The spec stores quantities as integers in the smallest base unit (grams, millilitres, or thousandths of a unit). `.claude/rules/ledger.md` allows either `bigint` or validated safe integers. The first ledger function (`addQuantities`) needs one of them.

## Decision

A quantity is a JavaScript `number` that must be a safe integer (`Number.isSafeInteger`), up to ±9,007,199,254,740,991. That is about 9 billion tonnes in grams, far beyond any stock level. Ledger functions validate their inputs and results and throw a `RangeError` instead of silently losing precision.

Money stays out of this: totals are integer cents and unit costs use a decimal library, as the spec says.

## Alternatives considered

`bigint`: no size limit, but it is not valid JSON and needs converting at every boundary (HTTP, Zod schemas, Postgres driver), for headroom we will never use.
