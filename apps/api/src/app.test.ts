import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { testConfig } from "./test/helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Collects the JSON log lines pino writes, instead of printing them.
function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split("\n")) {
        if (line) lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  return { lines, stream };
}

const quiet = testConfig();

describe("GET /health", () => {
  it("returns status ok and the running version", async () => {
    const app = buildApp(quiet);
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", version: "test-version" });
    await app.close();
  });

  it("writes no log lines when it succeeds: Render calls it every few seconds", async () => {
    const { lines, stream } = captureLogs();
    const app = buildApp(testConfig({ LOG_LEVEL: "info" }), {
      logStream: stream,
    });
    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(lines.filter((line) => "req" in line || "res" in line)).toEqual([]);
  });
});

describe("request IDs", () => {
  it("tags the response and every log line of the request with the same ID", async () => {
    const { lines, stream } = captureLogs();
    const app = buildApp(testConfig({ LOG_LEVEL: "info" }), {
      logStream: stream,
    });
    // Any logged route; /api/me answers 401 without a session.
    const response = await app.inject({ method: "GET", url: "/api/me" });
    await app.close();

    const requestId = response.headers["x-request-id"];
    expect(requestId).toMatch(UUID);

    const requestLines = lines.filter((line) => "req" in line || "res" in line);
    expect(requestLines.length).toBeGreaterThanOrEqual(2); // "incoming request" and "request completed"
    for (const line of requestLines) {
      expect(line.reqId).toBe(requestId);
    }
  });

  it("ignores a request ID sent by the client", async () => {
    const app = buildApp(quiet);
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "injected-by-client" },
    });
    await app.close();

    expect(response.headers["x-request-id"]).toMatch(UUID);
  });

  it("gives each request its own ID", async () => {
    const app = buildApp(quiet);
    const first = await app.inject({ method: "GET", url: "/health" });
    const second = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(first.headers["x-request-id"]).not.toBe(
      second.headers["x-request-id"],
    );
  });
});
