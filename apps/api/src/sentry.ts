import * as Sentry from "@sentry/node";
import type { SentryConfig } from "./config";

// What Sentry may collect besides the error and its stack trace. Our users are staff in the EU, so
// nothing personal or request-specific: the user's ID and the request ID (tags below) are enough
// to find the rest in our own logs. Sentry 11 would otherwise send IP addresses, request bodies,
// headers, cookies, query values and local variables.
const dataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
} satisfies Sentry.NodeOptions["dataCollection"];

/** Sentry's settings, or null without a DSN: then Sentry is never started (local dev, tests). */
export function sentryOptions(config: SentryConfig): Sentry.NodeOptions | null {
  if (!config.SENTRY_DSN) return null;
  return {
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
    // The running commit, the same `version` that GET /health reports.
    release: config.APP_VERSION,
    // No tracesSampleRate: errors only, no performance tracing.
    dataCollection,
  };
}

// Sentry gives every incoming request its own "isolation scope", so these tags only reach errors
// from that request. Both do nothing while Sentry is off.

/** Tags errors with the request ID, the `reqId` of the matching log lines. */
export function tagRequest(requestId: string) {
  Sentry.getIsolationScope().setTag("request_id", requestId);
}

/** Tags errors with the signed-in user's ID (a UUID; no name or email). */
export function tagUser(userId: string) {
  Sentry.getIsolationScope().setUser({ id: userId });
}
