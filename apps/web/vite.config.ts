/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The browser only ever talks to this origin; /api is forwarded to the API, so session cookies
// are plain first-party cookies and no CORS is needed. On Render, the static site forwards /api
// the same way (render.yaml). BETTER_AUTH_URL in apps/api/.env must be this origin: http://localhost:5173.
const api = {
  "/api": { target: "http://127.0.0.1:3000" },
};

export default defineConfig(({ command, mode }) => ({
  define: {
    // The commit being built, tagged on errors sent to Sentry. Render sets RENDER_GIT_COMMIT.
    __APP_VERSION__: JSON.stringify(process.env.RENDER_GIT_COMMIT ?? "dev"),
    // The component gallery (/gallery) is in the dev server and the browser tests' build
    // (`vite build --mode e2e`) only; staging and production builds leave it out entirely
    // (decision 0024).
    __GALLERY__: command === "serve" || mode === "e2e",
    // vue-i18n's build flags: the Composition API only, so its legacy API is left out of the
    // bundle, and no devtools hooks in production.
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon-180x180.png",
        "icon.svg",
      ],
      manifest: {
        name: "kitchen-ops",
        short_name: "kitchen-ops",
        description: "Compras y control de stock",
        lang: "es",
        start_url: "/",
        display: "standalone",
        background_color: "#f4f1e8",
        theme_color: "#1f5135",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Cache only the app itself. API responses are never cached: they depend on who is
        // signed in, and a shared phone must not show the previous user's data.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { port: 5173, strictPort: true, proxy: api },
  // `vite preview` (the built app, with the service worker) uses the same origin and proxy.
  preview: { port: 5173, strictPort: true, proxy: api },
  test: {
    // Browser tests are Playwright's (e2e/), not Vitest's.
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    // Vitest empties CSS imports; the token tests read tokens.css as text (?raw).
    css: { include: [/tokens\.css/] },
  },
}));
