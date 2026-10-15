import { describe, expect, it } from "vitest";
import { sentryOptions } from "./sentry";

// Synthetic: the shape of a Sentry DSN on a reserved .test domain.
const SENTRY_DSN = "https://examplekey@sentry.example.test/1";
const base = { NODE_ENV: "production" as const, APP_VERSION: "abc123" };

describe("sentryOptions", () => {
  it("is null without a DSN, so local dev and tests never start Sentry", () => {
    expect(sentryOptions(base)).toBeNull();
  });

  it("tags errors with the environment and the running commit", () => {
    const options = sentryOptions({
      ...base,
      SENTRY_DSN,
      SENTRY_ENVIRONMENT: "staging",
    });
    expect(options).toMatchObject({
      dsn: SENTRY_DSN,
      environment: "staging",
      release: "abc123",
    });
  });

  it("falls back to NODE_ENV as the environment", () => {
    expect(sentryOptions({ ...base, SENTRY_DSN })?.environment).toBe(
      "production",
    );
  });

  it("sends errors only, without personal or request data", () => {
    const options = sentryOptions({ ...base, SENTRY_DSN });
    expect(options?.tracesSampleRate).toBeUndefined();
    expect(options?.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    });
  });
});
