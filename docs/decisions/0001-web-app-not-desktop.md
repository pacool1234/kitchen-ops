# 0001. Web app (PWA), not a desktop app

- Status: Accepted
- Date: 2026-10-14

## Context

Counts and deliveries happen on phones in storerooms, the owner reads reports from anywhere, and several people work at once. A desktop app would still need a central server and database, plus installers and per-machine updates.

## Decision

A responsive Vue PWA served from one hosted API. Offline counting may be added if storerooms have no signal (discovery question).

## Alternatives considered

Electron/Tauri desktop app.
