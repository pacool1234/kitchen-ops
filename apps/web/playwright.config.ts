import { defineConfig, devices } from "@playwright/test";

// Browser tests (decision 0021): the built web app (`vite preview`) and the API, against a fresh
// database of their own, at desktop and phone sizes. Run with `pnpm --filter @kitchen-ops/web e2e`,
// with Postgres and the S3 server up (`docker compose up -d`) and the dev servers stopped: they use
// the same ports.

const WEB = "http://localhost:5173";

export default defineConfig({
  testDir: "e2e",
  // A flaky test is a bug to fix, not to retry.
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Counter tasks are phone-first (spec section 11.2): Chromium with a phone's size and touch.
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      // Resets, migrates and seeds kitchen_ops_e2e, then starts the API on 127.0.0.1:3000.
      command: "node e2e/start-api.ts",
      url: "http://127.0.0.1:3000/health",
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
    },
    {
      command: "vite preview",
      url: WEB,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
