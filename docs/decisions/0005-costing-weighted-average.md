# 0005. Costing: weighted average; recipes at latest price

- Status: Accepted
- Date: 2026-10-14

## Context

A management tool, not the official accounts (those stay with the gestoría). Spanish rules accept both weighted average and FIFO. FIFO needs cost layers, and backdated documents reshuffle every later layer; its 'oldest used first' assumption can't be verified in a kitchen.

## Decision

Weighted average per product and storeroom for valuation and variance. Recipe costing uses the latest purchase price.

## Alternatives considered

FIFO.
