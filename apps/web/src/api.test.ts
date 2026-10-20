import { endpoint, endpoints } from "@kitchen-ops/shared";
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

const uploadThing = endpoint({
  method: "POST",
  path: "/api/things",
  summary: "Upload a thing's files",
  access: "signed-in",
  upload: { field: "files" },
  status: 201,
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
    await call(getThing, {
      params: { id: "1" },
      query: { include: undefined },
    });
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

  it("a refused field comes with its code: the API's fields, kept on the ApiError (#89)", async () => {
    fakeFetch(409, { error: "conflict", fields: { taxId: "taken" } });
    const error = await call(getThing, { params: { id: "1" } }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      status: 409,
      code: "conflict",
      fields: { taxId: "taken" },
    });
  });

  it("fields that aren't the API's codes are left out, not trusted", async () => {
    fakeFetch(400, { error: "invalid_input", fields: { taxId: "made_up" } });
    const error = await call(getThing, { params: { id: "1" } }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: "invalid_input", fields: undefined });
  });

  it("is typed by the contract: what an endpoint needs is required, what it doesn't take is refused", () => {
    // Never called: these lines are checked by the typechecker (`pnpm typecheck`), which fails
    // if any @ts-expect-error below stops being an error.
    const typeChecks = () => {
      // @ts-expect-error: a path parameter is required.
      void call(getThing);
      // @ts-expect-error: the body is required.
      void call(renameThing, { params: { id: "1" } });
      // @ts-expect-error: a body's fields are typed.
      void call(renameThing, { params: { id: "1" }, body: { name: 1 } });
      // @ts-expect-error: /api/me takes no parameters.
      void call(endpoints.me, { params: { id: "1" } });
      // @ts-expect-error: an upload needs its files.
      void call(uploadThing);
      const notAnUpload = { params: { id: "1" }, body: { name: "a" } };
      // @ts-expect-error: only an upload takes files.
      void call(renameThing, { ...notAnUpload, files: [] });
      // An endpoint with nothing to send needs no input, and its result is typed.
      const me: Promise<{ role: string }> = call(endpoints.me);
      void me;
    };
    expect(typeChecks).toBeTypeOf("function");
  });

  it("sends an upload's files as a form, in order, under the endpoint's field, letting the browser set its type (#106)", async () => {
    const calls = fakeFetch(201, { id: "1", name: "Albarán" });
    const first = new File(["page 1"], "1.jpg", { type: "image/jpeg" });
    const second = new File(["page 2"], "2.jpg", { type: "image/jpeg" });
    await call(uploadThing, { files: [first, second] });

    const { method, body, headers } = calls[0]!.init;
    expect(method).toBe("POST");
    expect(body).toBeInstanceOf(FormData);
    const sent = (body as FormData).getAll("files") as File[];
    expect(sent.map((f) => f.name)).toEqual(["1.jpg", "2.jpg"]);
    expect(await sent[1]!.text()).toBe("page 2");
    // The browser writes multipart/form-data with its boundary itself.
    expect(new Headers(headers).has("content-type")).toBe(false);
  });

  it("a file already received: the ApiError names the document that has it (#106)", async () => {
    const earlier = "0199a000-0000-7000-8000-000000000001";
    fakeFetch(409, {
      error: "conflict",
      fields: { "files.1": "taken" },
      duplicateOf: earlier,
    });
    const error = await call(uploadThing, {
      files: [new File(["x"], "x.pdf")],
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 409,
      code: "conflict",
      fields: { "files.1": "taken" },
      duplicateOf: earlier,
    });
  });

  it("refuses a response that doesn't match the endpoint's schema", async () => {
    fakeFetch(200, { id: 1 });
    await expect(call(getThing, { params: { id: "1" } })).rejects.toMatchObject(
      { code: "unexpected_response" },
    );
  });
});
