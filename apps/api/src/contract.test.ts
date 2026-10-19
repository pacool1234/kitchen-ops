import { readFileSync } from "node:fs";
import { endpoints, type Endpoint } from "@kitchen-ops/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { OPENAPI_FILE, routeConfig } from "./contract";
import { testConfig } from "./test/helpers";

// Typed as any endpoint, so the checks cover access by role before any endpoint uses it.
const contract: readonly Endpoint[] = Object.values(endpoints);

/** The routes the app registers once ready, without Fastify's automatic HEAD routes. */
async function registeredRoutes() {
  const app = buildApp(testConfig());
  const routes: { method: string; url: string; hasResponse: boolean }[] = [];
  app.addHook("onRoute", (route) => {
    for (const method of [route.method].flat()) {
      if (method === "HEAD") continue;
      const response = route.schema?.response as
        Record<string, unknown> | undefined;
      routes.push({
        method,
        url: route.url,
        hasResponse: Boolean(response?.[200] ?? response?.[201]),
      });
    }
  });
  await app.ready();
  await app.close();
  return routes;
}

async function openApiDocument() {
  const app = buildApp(testConfig());
  const response = await app.inject({
    method: "GET",
    url: "/api/openapi.json",
  });
  await app.close();
  expect(response.statusCode).toBe(200);
  return response.json<{
    openapi: string;
    paths: Record<string, Record<string, Record<string, unknown>>>;
  }>();
}

const openApiPath = (path: string) => path.replace(/:([A-Za-z]+)/g, "{$1}");

describe("the API is built from the contract (decision 0022)", () => {
  it("every route except Better Auth's is a contract endpoint, with a response schema", async () => {
    const routes = await registeredRoutes();
    for (const route of routes) {
      const declared = contract.some(
        (e) => e.method === route.method && e.path === route.url,
      );
      expect(
        declared,
        `${route.method} ${route.url} isn't in the contract`,
      ).toBe(true);
      expect(
        route.hasResponse,
        `${route.method} ${route.url} has no response schema`,
      ).toBe(true);
    }
  });

  it("every contract endpoint is registered", async () => {
    const routes = await registeredRoutes();
    for (const e of contract) {
      expect(
        routes.some((r) => r.method === e.method && r.url === e.path),
        `${e.method} ${e.path}`,
      ).toBe(true);
    }
  });

  it("who may call an endpoint becomes the route's auth config", () => {
    expect(routeConfig("public")).toEqual({ public: true });
    expect(routeConfig("signed-in")).toEqual({});
    expect(routeConfig({ roles: ["office", "owner"] })).toEqual({
      roles: ["office", "owner"],
    });
  });

  it("public endpoints answer without a session; the others answer 401", async () => {
    const app = buildApp(testConfig());
    for (const e of contract) {
      const response = await app.inject({ method: e.method, url: e.path });
      if (e.access === "public") expect(response.statusCode, e.path).toBe(200);
      else expect(response.statusCode, e.path).toBe(401);
    }
    await app.close();
  });
});

describe("GET /api/openapi.json: the OpenAPI document", () => {
  it("is OpenAPI 3.1, with exactly one operation per contract endpoint", async () => {
    const doc = await openApiDocument();
    expect(doc.openapi).toMatch(/^3\.1\./);
    const operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(operations.sort()).toEqual(
      contract.map((e) => `${e.method} ${openApiPath(e.path)}`).sort(),
    );
  });

  it("each operation has its summary, its success response schema and who may call it", async () => {
    const doc = await openApiDocument();
    for (const e of contract) {
      const operation =
        doc.paths[openApiPath(e.path)]![e.method.toLowerCase()]!;
      expect(operation.summary, e.path).toBe(e.summary);
      expect(operation["x-roles"], e.path).toEqual(
        e.access === "public"
          ? "public"
          : e.access === "signed-in"
            ? "any signed-in user"
            : e.access.roles,
      );
      const responses = operation.responses as Record<
        string,
        { content?: unknown }
      >;
      expect(responses[String(e.status ?? 200)]?.content, e.path).toBeDefined();
      if (e.access !== "public") {
        expect(Object.keys(responses), e.path).toEqual(
          expect.arrayContaining(["401", "403"]),
        );
      }
    }
  });

  it("describes each refusal an operation can answer: 400 for input, 404 for an ID in the path, 409 for a value that must be unique", async () => {
    const doc = await openApiDocument();
    for (const e of contract) {
      const operation =
        doc.paths[openApiPath(e.path)]![e.method.toLowerCase()]!;
      const statuses = Object.keys(operation.responses as object);
      const name = `${e.method} ${e.path}`;
      expect(statuses.includes("400"), name).toBe(
        Boolean(e.params ?? e.query ?? e.body ?? e.upload),
      );
      expect(statuses.includes("503"), name).toBe(Boolean(e.needsStorage));
      expect(statuses.includes("404"), name).toBe(Boolean(e.params));
      expect(statuses.includes("409"), name).toBe(Boolean(e.conflict));
    }
  });

  it("an upload is described as multipart/form-data, with its files as binary parts", async () => {
    const doc = await openApiDocument();
    const upload = doc.paths["/api/documents"]!.post!;
    expect(upload.requestBody).toMatchObject({
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: {
              files: {
                type: "array",
                items: { type: "string", format: "binary" },
              },
            },
            required: ["files"],
          },
        },
      },
    });
  });

  it("leaves Better Auth's routes out: its own client calls them", async () => {
    const doc = await openApiDocument();
    expect(Object.keys(doc.paths).some((p) => p.startsWith("/api/auth"))).toBe(
      false,
    );
  });

  it("the committed apps/api/openapi.json is what the API serves: run `pnpm --filter @kitchen-ops/api openapi:write`", async () => {
    const committed: unknown = JSON.parse(readFileSync(OPENAPI_FILE, "utf8"));
    expect(await openApiDocument()).toEqual(committed);
  });
});
