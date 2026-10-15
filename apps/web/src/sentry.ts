import * as Sentry from "@sentry/vue";
import type { App } from "vue";

type SentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

interface SentryEnv {
  PROD: boolean;
  VITE_SENTRY_DSN?: string;
  VITE_SENTRY_ENVIRONMENT?: string;
}

// Errors and their stack traces only. Staff data stays out of Sentry: no IP address, cookies,
// request details or component props. The API's errors carry the user's ID and request ID.
const dataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  stackFrameVariables: false,
} satisfies SentryInitOptions["dataCollection"];

/** Sentry's settings, or null: Sentry runs only in a build that was given a DSN (Render). */
export function sentryOptions(
  env: SentryEnv,
  release: string,
): SentryInitOptions | null {
  if (!env.PROD || !env.VITE_SENTRY_DSN) return null;
  return {
    dsn: env.VITE_SENTRY_DSN,
    environment: env.VITE_SENTRY_ENVIRONMENT || "production",
    release,
    // No tracesSampleRate and no replay integration: errors only.
    attachProps: false,
    dataCollection,
  };
}

/** Starts Sentry before the app mounts. `#sentry-test` at the end of any address sends a test error. */
export function initSentry(app: App) {
  const options = sentryOptions(import.meta.env, __APP_VERSION__);
  if (!options) return;
  Sentry.init({ app, ...options });
  if (window.location.hash === "#sentry-test") {
    setTimeout(() => {
      throw new Error("Sentry test from the web app (#sentry-test)");
    });
  }
}
