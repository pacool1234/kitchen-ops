// Starts Sentry before anything else loads:
//   node --import tsx --import ./src/instrument.ts src/server.ts
// Sentry has to hook into http and Fastify as they are first imported, to catch errors from routes
// and hooks and to keep each request's tags separate. Without SENTRY_DSN it does nothing.
import * as Sentry from "@sentry/node";
import { ConfigError, loadSentryConfig } from "./config";
import { sentryOptions } from "./sentry";

try {
  const options = sentryOptions(loadSentryConfig(process.env));
  if (options) Sentry.init(options);
} catch (error) {
  // server.ts reports every configuration problem and exits; until then Sentry stays off.
  if (!(error instanceof ConfigError)) throw error;
}
