# 0042. How an open app takes a new version

- Status: Accepted
- Date: 2026-10-21

## Context

The web app is a PWA (decision 0001). Its service worker caches the app itself, never `/api`. It was set up with `vite-plugin-pwa`'s `registerType: "autoUpdate"` and the plugin's own registration script, and nothing in the app heard about a new version. Trying the demo invoice on staging (#120) showed what that means:
- **A browser looks for a new service worker only on a full page load,** and moving around this app never loads one. A tab left open, or a phone app kept in the background for days (spec 11.1), keeps the old version.
- **An old version talking to a new API can fail in ways that are hard to see.** A review page showed its lines with nothing under them until a hard reload (#140).
- **Pages are chunks with hashed names, loaded when first opened.** Once a new version takes over, the old one's cache is gone and the server has only the new names. An old tab opening a page it hadn't opened yet fails to load it.

## Decision

1. **A new version waits** (`registerType: "prompt"`) until the tab takes it. The app registers the service worker itself (`src/shell/app-update.ts`, with the plugin's `virtual:pwa-register`).
2. **An open tab asks for one every 30 minutes, and when it's shown again,** but not twice within a minute. Each check is one request for the service worker file.
3. **When one is waiting, a bar above every page says so,** announced politely (`role="status"`):
   - **Recargar** (Reload) takes it now;
   - **Ahora no** (Not now) hides the bar until the next check.
4. **Otherwise it's taken on the next move to another page inside the app,** and that page opens in the new version. The unsaved-changes guard (#89) runs first, so nothing unsaved is lost. Nothing reloads while someone stays on a page.
5. **A page whose code fails to load is loaded again, once.** It's not loaded again for the same page within 10 seconds, so a chunk that's really missing shows an error rather than looping.

`workbox-window`, which the plugin's registration imports, becomes the web app's own dependency, at the 7.4.1 already installed for the plugin.

## Alternatives considered

- **Reload by itself whenever nothing is marked unsaved.** Not everything that can be lost is marked: an open dialog, a search typed but not run, a photo being taken. A reload in the middle of those is worse than an old version for a few minutes more.
- **Keep `autoUpdate`, register the service worker from the app, and add the checks.** In that mode the plugin reloads every open tab as soon as the new version takes over, including a tab halfway through a correction.
- **Only the bar, without taking the new version on navigation.** People ignore bars: a phone could stay on the old version all day.
