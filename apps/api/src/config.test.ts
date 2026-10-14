import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

describe("loadConfig", () => {
  it("applies defaults for everything except APP_VERSION", () => {
    expect(loadConfig({ APP_VERSION: "abc123" })).toEqual({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 3000,
      LOG_LEVEL: "info",
      APP_VERSION: "abc123",
    });
  });

  it("reads and converts values from the environment", () => {
    const config = loadConfig({
      APP_VERSION: "abc123",
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
  });

  it("rejects an empty APP_VERSION", () => {
    expect(() => loadConfig({ APP_VERSION: "" })).toThrow(/APP_VERSION/);
  });

  it("rejects a PORT that is not a valid port number", () => {
    expect(() => loadConfig({ APP_VERSION: "x", PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ APP_VERSION: "x", PORT: "70000" })).toThrow(
      /PORT/,
    );
  });

  it("reports every problem at once and points to .env.example", () => {
    let message = "";
    try {
      loadConfig({ PORT: "abc", LOG_LEVEL: "loud" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/APP_VERSION/);
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/LOG_LEVEL/);
    expect(message).toMatch(/\.env\.example/);
  });
});
