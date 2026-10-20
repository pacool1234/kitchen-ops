// Starts the API for the browser tests (decision 0021), from a fresh database of their own:
// db:reset, db:migrate and db:seed, then `start`. Run by playwright.config.ts, never by hand.
//
// NODE_ENV is "test", not "production": in production Better Auth allows 3 sign-ins per 10
// seconds from one address, and the tests sign in more often than that. CI checks separately
// that the API starts in production mode.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const env = {
  ...process.env,
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "3000",
  LOG_LEVEL: "warn",
  APP_VERSION: "e2e",
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ??
    "postgres://kitchen_ops:kitchen_ops@127.0.0.1:5432/kitchen_ops_e2e",
  // A new secret every run: nothing secret-like is written in this file.
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
  BETTER_AUTH_URL: "http://localhost:5173",
  // Documents (#106): kept in docker-compose.yml's local S3 server, and read by the fake model,
  // which fails only when a document says so, and is then retried after a second.
  S3_ENDPOINT: process.env.E2E_S3_ENDPOINT ?? "http://127.0.0.1:9000",
  S3_REGION: "fr-par",
  S3_BUCKET: "kitchen-ops-documents",
  S3_ACCESS_KEY_ID: "local-only-key",
  S3_SECRET_ACCESS_KEY: "local-only-secret",
  EXTRACTION_MODEL: "fake",
};

// pnpm sets npm_execpath to itself when it runs a script, so this works where `pnpm` isn't on
// the PATH (for example when it's only reachable through corepack).
const pnpm = (args: string[]) =>
  process.env.npm_execpath
    ? { command: process.execPath, args: [process.env.npm_execpath, ...args] }
    : { command: "pnpm", args };

for (const script of ["db:reset", "db:migrate", "db:seed"]) {
  const { command, args } = pnpm(["--filter", "@kitchen-ops/api", script]);
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) {
    console.error(
      `Couldn't run pnpm for ${script} (${result.error.message}): start the tests with \`pnpm --filter @kitchen-ops/web e2e\`.`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `${script} failed: are Postgres and the S3 server up (docker compose up -d)?`,
    );
    process.exit(result.status ?? 1);
  }
}

const { command, args } = pnpm(["--filter", "@kitchen-ops/api", "start"]);
const api = spawn(command, args, { env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => api.kill(signal));
}
api.on("exit", (code) => process.exit(code ?? 0));
