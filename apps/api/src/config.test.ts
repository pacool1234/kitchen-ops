import { describe, expect, it } from "vitest";
import {
  ConfigError,
  loadConfig,
  loadDatabaseUrl,
  loadSeedConfig,
  loadSentryConfig,
  storageConfig,
} from "./config";

const DATABASE_URL = "postgres://user:pass@localhost:5432/db";
// Built at runtime so it never looks like a real secret: 32 "x" characters.
const BETTER_AUTH_SECRET = "x".repeat(32);
const BETTER_AUTH_URL = "http://127.0.0.1:3000";
// Synthetic: the shape of a Sentry DSN on a reserved .test domain.
const SENTRY_DSN = "https://examplekey@sentry.example.test/1";
const required = {
  APP_VERSION: "abc123",
  DATABASE_URL,
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
};

describe("loadConfig", () => {
  it("applies defaults for everything except the required variables", () => {
    expect(loadConfig(required)).toEqual({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 3000,
      LOG_LEVEL: "info",
      APP_VERSION: "abc123",
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
    });
  });

  it("reads and converts values from the environment", () => {
    const config = loadConfig({
      ...required,
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      PORT: "10000",
      LOG_LEVEL: "warn",
    });
    expect(config.PORT).toBe(10000);
    expect(config.NODE_ENV).toBe("production");
  });

  it("fails fast with a clear message when a required variable is missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/APP_VERSION: is required/);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL: is required/);
    expect(() => loadConfig({})).toThrow(/BETTER_AUTH_SECRET: is required/);
    expect(() => loadConfig({})).toThrow(/BETTER_AUTH_URL: is required/);
  });

  it("rejects a BETTER_AUTH_SECRET shorter than 32 characters, without printing it", () => {
    const short = "y".repeat(31);
    expect(() =>
      loadConfig({ ...required, BETTER_AUTH_SECRET: short }),
    ).toThrow(/BETTER_AUTH_SECRET: must be at least 32 characters/);
    expect(() =>
      loadConfig({ ...required, BETTER_AUTH_SECRET: short }),
    ).not.toThrow(new RegExp(short));
  });

  it("rejects a BETTER_AUTH_URL that is not an http(s) URL", () => {
    expect(() =>
      loadConfig({ ...required, BETTER_AUTH_URL: "127.0.0.1:3000" }),
    ).toThrow(/BETTER_AUTH_URL: must be an http\(s\) URL/);
  });

  it("rejects an empty APP_VERSION", () => {
    expect(() => loadConfig({ ...required, APP_VERSION: "" })).toThrow(
      /APP_VERSION/,
    );
  });

  it("rejects a PORT that is not a valid port number", () => {
    expect(() => loadConfig({ ...required, PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ ...required, PORT: "70000" })).toThrow(/PORT/);
  });

  it("rejects a DATABASE_URL that is not a postgres:// URL", () => {
    for (const url of ["localhost:5432", "mysql://u:p@localhost/db", ""]) {
      expect(() => loadConfig({ ...required, DATABASE_URL: url })).toThrow(
        /DATABASE_URL: must be a postgres:\/\/ URL/,
      );
    }
    expect(
      loadConfig({ ...required, DATABASE_URL: "postgresql://u:p@host/db" })
        .DATABASE_URL,
    ).toBe("postgresql://u:p@host/db");
  });

  it("reports every problem at once and points to .env.example", () => {
    let message = "";
    try {
      loadConfig({ PORT: "abc", LOG_LEVEL: "loud" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/APP_VERSION/);
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/LOG_LEVEL/);
    expect(message).toMatch(/\.env\.example/);
  });

  it("leaves Sentry off unless SENTRY_DSN is set; empty counts as unset", () => {
    expect(loadConfig(required).SENTRY_DSN).toBeUndefined();
    expect(
      loadConfig({ ...required, SENTRY_DSN: "" }).SENTRY_DSN,
    ).toBeUndefined();
    expect(
      loadConfig({ ...required, SENTRY_ENVIRONMENT: "" }).SENTRY_ENVIRONMENT,
    ).toBeUndefined();
    expect(loadConfig({ ...required, SENTRY_DSN }).SENTRY_DSN).toBe(SENTRY_DSN);
  });

  it("rejects a SENTRY_DSN that is not an https URL, without printing it", () => {
    for (const dsn of ["examplekey@sentry.example.test/1", "http://k@h/1"]) {
      expect(() => loadConfig({ ...required, SENTRY_DSN: dsn })).toThrow(
        /SENTRY_DSN: must be an https URL/,
      );
      expect(() => loadConfig({ ...required, SENTRY_DSN: dsn })).not.toThrow(
        /examplekey/,
      );
    }
  });

  it("never prints the value of DATABASE_URL, which contains a password", () => {
    expect(() =>
      loadConfig({ ...required, DATABASE_URL: "mysql://u:hunter2@h/db" }),
    ).not.toThrow(/hunter2/);
  });
});

describe("storage (#102)", () => {
  // Local-only values, as in docker-compose.yml.
  const storage = {
    S3_ENDPOINT: "http://127.0.0.1:9000",
    S3_REGION: "fr-par",
    S3_BUCKET: "kitchen-ops-documents",
    S3_ACCESS_KEY_ID: "local-only-key",
    S3_SECRET_ACCESS_KEY: "local-only-secret",
  };

  it("is off without its variables: the API still starts", () => {
    expect(storageConfig(loadConfig(required))).toBeNull();
  });

  it("is on with all five", () => {
    expect(storageConfig(loadConfig({ ...required, ...storage }))).toEqual({
      endpoint: "http://127.0.0.1:9000",
      region: "fr-par",
      bucket: "kitchen-ops-documents",
      accessKeyId: "local-only-key",
      secretAccessKey: "local-only-secret",
    });
  });

  it("refuses some without the others, naming each one missing, without printing the secret", () => {
    const partial = Object.fromEntries(
      Object.entries(storage).filter(
        ([name]) => name !== "S3_BUCKET" && name !== "S3_REGION",
      ),
    );
    expect(() => loadConfig({ ...required, ...partial })).toThrow(ConfigError);
    expect(() => loadConfig({ ...required, ...partial })).toThrow(
      /S3_REGION: is required with[\s\S]*S3_BUCKET: is required with/,
    );
    expect(() => loadConfig({ ...required, ...partial })).not.toThrow(
      /local-only-secret/,
    );
  });
});

describe("loadDatabaseUrl", () => {
  it("needs only DATABASE_URL, for the db scripts", () => {
    expect(loadDatabaseUrl({ DATABASE_URL })).toBe(DATABASE_URL);
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => loadDatabaseUrl({})).toThrow(/DATABASE_URL: is required/);
  });
});

describe("loadSeedConfig", () => {
  it("needs the database and auth variables, not APP_VERSION", () => {
    expect(
      loadSeedConfig({ DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL }),
    ).toEqual({ DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL });
  });

  it("fails fast when one of them is missing", () => {
    expect(() => loadSeedConfig({ DATABASE_URL })).toThrow(
      /BETTER_AUTH_SECRET: is required/,
    );
  });
});

describe("loadSentryConfig", () => {
  it("needs only what Sentry uses, so it can start before the rest is checked", () => {
    expect(
      loadSentryConfig({
        APP_VERSION: "abc123",
        SENTRY_DSN,
        SENTRY_ENVIRONMENT: "staging",
      }),
    ).toEqual({
      NODE_ENV: "development",
      APP_VERSION: "abc123",
      SENTRY_DSN,
      SENTRY_ENVIRONMENT: "staging",
    });
  });
});
