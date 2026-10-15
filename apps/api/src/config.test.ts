import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadDatabaseUrl } from "./config";

const DATABASE_URL = "postgres://user:pass@localhost:5432/db";
const required = { APP_VERSION: "abc123", DATABASE_URL };

describe("loadConfig", () => {
  it("applies defaults for everything except the required variables", () => {
    expect(loadConfig(required)).toEqual({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 3000,
      LOG_LEVEL: "info",
      APP_VERSION: "abc123",
      DATABASE_URL,
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

  it("never prints the value of DATABASE_URL, which contains a password", () => {
    expect(() =>
      loadConfig({ ...required, DATABASE_URL: "mysql://u:hunter2@h/db" }),
    ).not.toThrow(/hunter2/);
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
