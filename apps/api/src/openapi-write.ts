// Writes the OpenAPI document the API serves to apps/api/openapi.json (decision 0022), so every
// API change shows up in review. A test fails while the committed file is out of date.
//   pnpm --filter @kitchen-ops/api openapi:write
// No database is touched: the pool connects only on a query, this route never queries, and no
// background jobs start.
import { writeFileSync } from "node:fs";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { OPENAPI_FILE } from "./contract";

const app = buildApp(
  loadConfig({
    APP_VERSION: "openapi",
    DATABASE_URL: "postgres://openapi@127.0.0.1:5432/unused",
    // Never used to sign anything: a placeholder built at runtime.
    BETTER_AUTH_SECRET: "-".repeat(32),
    BETTER_AUTH_URL: "http://127.0.0.1:3000",
    LOG_LEVEL: "silent",
  }),
  { jobs: false },
);
try {
  const response = await app.inject({
    method: "GET",
    url: "/api/openapi.json",
  });
  if (response.statusCode !== 200) {
    throw new Error(`GET /api/openapi.json answered ${response.statusCode}`);
  }
  writeFileSync(OPENAPI_FILE, `${JSON.stringify(response.json(), null, 2)}\n`);
  console.log("Wrote apps/api/openapi.json.");
} finally {
  await app.close();
}
