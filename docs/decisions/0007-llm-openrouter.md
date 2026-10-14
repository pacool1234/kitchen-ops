# 0007. LLM access: OpenRouter

- Status: Accepted
- Date: 2026-10-14

## Context

One API to compare many models cheaply during evaluation. Existing credits.

## Decision

OpenRouter for all extraction calls. Each eval run includes a frontier model as the accuracy ceiling. Runs over client documents must restrict routing to providers that neither train on nor retain data.

## Alternatives considered

Direct provider APIs (fewer models to compare).
