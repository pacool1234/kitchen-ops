// The seed, as a command: `pnpm --filter @kitchen-ops/api db:seed`. Locally it adds the
// fictional restaurant and the local-only logins; on staging, its demo with logins of its own
// (#100, decision 0028). With storage, the demo documents too (#119, decision 0039). Never real supplier, client or staff data. Production is never seeded.
import { createAuth } from "../auth/auth";
import { ConfigError, loadSeedConfig, storageConfig } from "../config";
import { createS3Storage } from "../storage/s3";
import { createDb } from "./client";
import { planSeed, SeedRefused } from "./seed-plan";
import { runSeed } from "./seed-run";

try {
  const plan = planSeed(process.env);
  const config = loadSeedConfig(process.env);
  const { db, close } = createDb(config.DATABASE_URL);
  try {
    const s3 = storageConfig(config);
    await runSeed(
      db,
      createAuth(db, config),
      plan,
      s3 ? createS3Storage(s3) : null,
    );
  } finally {
    await close();
  }
} catch (error) {
  console.error(
    error instanceof ConfigError || error instanceof SeedRefused
      ? error.message
      : error,
  );
  process.exit(1);
}
