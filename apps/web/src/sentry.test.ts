import { describe, expect, it } from "vitest";
import { sentryOptions } from "./sentry";

// Synthetic: the shape of a Sentry DSN on a reserved .test domain.
const VITE_SENTRY_DSN = "https://examplekey@sentry.example.test/2";

describe("sentryOptions", () => {
  it("is null in development, even with a DSN", () => {
    expect(
      sentryOptions({ PROD: false, VITE_SENTRY_DSN }, "abc123"),
    ).toBeNull();
  });

  it("is null in a build without a DSN (empty counts as missing)", () => {
    expect(sentryOptions({ PROD: true }, "abc123")).toBeNull();
    expect(
      sentryOptions({ PROD: true, VITE_SENTRY_DSN: "" }, "abc123"),
    ).toBeNull();
  });

  it("tags errors with the environment and the commit that was built", () => {
    expect(
      sentryOptions(
        { PROD: true, VITE_SENTRY_DSN, VITE_SENTRY_ENVIRONMENT: "staging" },
        "abc123",
      ),
    ).toMatchObject({
      dsn: VITE_SENTRY_DSN,
      environment: "staging",
      release: "abc123",
    });
  });

  it("falls back to production as the environment", () => {
    expect(
      sentryOptions({ PROD: true, VITE_SENTRY_DSN }, "abc123")?.environment,
    ).toBe("production");
  });

  it("sends errors only, without personal data, requests or component props", () => {
    const options = sentryOptions({ PROD: true, VITE_SENTRY_DSN }, "abc123");
    expect(options?.tracesSampleRate).toBeUndefined();
    expect(options?.attachProps).toBe(false);
    expect(options?.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
  });
});
