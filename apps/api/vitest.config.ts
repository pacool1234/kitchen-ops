import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Creates and migrates the kitchen_ops_test database once per run (needs Postgres running).
    globalSetup: ["./src/test/global-setup.ts"],
    // Test files share that database, so run them one at a time.
    fileParallelism: false,
  },
});
