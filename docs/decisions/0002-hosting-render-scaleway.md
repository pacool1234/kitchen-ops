# 0002. Hosting on Render; object storage and backups on Scaleway

- Status: Accepted
- Date: 2026-10-14

## Context

One PaaS keeps one bill, one region and one dashboard, and runs a long-lived Node server plus a background worker natively. Render Postgres includes point-in-time recovery on paid instances. Render's own object storage is early access only, and the spec requires an independent database copy outside the main provider anyway.

## Decision

Render (EU region) for web, API, worker and Postgres. Scaleway Object Storage (EU, versioning on) for files and weekly encrypted database dumps.

## Alternatives considered

All-Vercel (serverless functions, external queue, partner Postgres; Hobby plan forbids commercial use). Vercel frontend + PaaS backend. Cloudflare R2 (good, but US company).
