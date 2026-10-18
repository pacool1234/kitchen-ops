import { endpoint } from "@kitchen-ops/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, call } from "./api";

// Endpoints that exercise every part of a request; the real contract has only GETs so far.
const Thing = z.object({ id: z.string(), name: z.string() });
const getThing = endpoint({
  method: "GET",
  path: "/api/things/:id",
  summary: "One thing",
  access: "signed-in",
  params: z.object({ id: z.string() }),
  query: z.object({ include: z.string().optional() }),
  response: Thing,
});
const renameThing = endpoint({
  method: "PATCH",
  path: "/api/things/:id",
  summary: "Rename a thing",
  access: { roles: ["office", "owner"] },
  params: z.object({ id: z.string() }),
  body: z.object({ name: z.string() }),
  response: Thing,
});

/** Replaces fetch with one that answers `status` and `body`, and remembers what it was asked. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("call: a contract endpoint, typed and validated (decision 0022)", () => {
  it("fills in the path's parameters, encoded, and the query", async () => {
    const calls = fakeFetch(200, { id: "a/b", name: "Tomato" });
    await call(getThing, {
      params: { id: "a/b" },
      query: { include: "units" },
    });
    expect(calls[0]!.url).toBe("/api/things/a%2Fb?include=units");
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.credentials).toBe("same-origin");
  });

  it("leaves out query values that are undefined", async () => {
    const calls = fakeFetch(200, { id: "1", name: "Tomato" });
    await call(getThing, { params: { id: "1" }, query: {} });
    expect(calls[0]!.url).toBe("/api/things/1");
  });

  it("sends a body as JSON, and returns the validated response", async () => {
    const calls = fakeFetch(200, { id: "1", name: "Onion" });
    const result = await call(renameThing, {
      params: { id: "1" },
      body: { name: "Onion" },
    });
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(calls[0]!.init.body).toBe('{"name":"Onion"}');
    expect(new Headers(calls[0]!.init.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(result).toEqual({ id: "1", name: "Onion" });
  });

  it("an error answer becomes an ApiError with the status and the API's code", async () => {
    fakeFetch(403, { error: "forbidden" });
    const error = await call(getThing, { params: { id: "1" } }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("refuses a response that doesn't match the endpoint's schema", async () => {
    fakeFetch(200, { id: 1 });
    await expect(call(getThing, { params: { id: "1" } })).rejects.toMatchObject(
      { code: "unexpected_response" },
    );
  });
});
