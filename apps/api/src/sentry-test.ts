// Sends one test error to Sentry with the API's settings, to check that a DSN works.
// On Render, in the API service's Shell tab:
//   cd apps/api && node --import tsx src/sentry-test.ts
// APP_VERSION is only set by the start command, so the deployed commit is used as the release.
import * as Sentry from "@sentry/node";
import { ConfigError, loadSentryConfig } from "./config";
import { sentryOptions } from "./sentry";

try {
  const options = sentryOptions(
    loadSentryConfig({
      APP_VERSION: process.env.RENDER_GIT_COMMIT ?? "local",
      ...process.env,
    }),
  );
  if (!options) {
    console.error(
      "SENTRY_DSN is not set: there is nowhere to send a test error.",
    );
    process.exit(1);
  }
  Sentry.init(options);
  const eventId = Sentry.captureException(
    new Error("Sentry test from the API (sentry-test.ts)"),
  );
  if (!(await Sentry.flush(10_000))) {
    console.error("Timed out sending the test error to Sentry.");
    process.exit(1);
  }
  console.log(
    `Sent test error ${eventId} (environment "${options.environment}", release "${options.release}"). It should appear in Sentry's Issues within a minute.`,
  );
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
