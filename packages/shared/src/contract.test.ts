import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildPath, endpoints } from "./contract";

/** The path's parameters read back from a URL path: the inverse of buildPath, for testing it. */
function readPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const names: string[] = [];
  const regex = new RegExp(
    `^${pattern.replace(/:([A-Za-z]+)/g, (_, name: string) => {
      names.push(name);
      return "([^/]+)";
    })}$`,
  );
  const match = regex.exec(path);
  if (!match) return null;
  return Object.fromEntries(
    names.map((name, i) => [name, decodeURIComponent(match[i + 1]!)]),
  );
}

describe("endpoints: the API's contract (decision 0022)", () => {
  it("every endpoint has a method, a path starting with /, a summary and who may call it", () => {
    for (const [name, endpoint] of Object.entries(endpoints)) {
      expect(["GET", "POST", "PUT", "PATCH", "DELETE"], name).toContain(
        endpoint.method,
      );
      expect(endpoint.path, name).toMatch(/^\//);
      expect(endpoint.summary, name).not.toBe("");
      expect(endpoint.access, name).toBeDefined();
    }
  });

  it("no two endpoints share a method and path", () => {
    const keys = Object.values(endpoints).map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("the routes that exist today: health, openapi, me, the audit log, and the catalogue", () => {
    const writers = { roles: ["office", "owner"] };
    expect(
      Object.values(endpoints).map((e) => [e.method, e.path, e.access]),
    ).toEqual([
      ["GET", "/health", "public"],
      ["GET", "/api/openapi.json", "public"],
      ["GET", "/api/me", "signed-in"],
      ["PATCH", "/api/me", "signed-in"],
      ["GET", "/api/audit-log", { roles: ["owner"] }],
      ["GET", "/api/storerooms", "signed-in"],
      ["GET", "/api/storerooms/:id", "signed-in"],
      ["POST", "/api/storerooms", writers],
      ["PATCH", "/api/storerooms/:id", writers],
      ["GET", "/api/suppliers", "signed-in"],
      ["GET", "/api/suppliers/:id", "signed-in"],
      ["POST", "/api/suppliers", writers],
      ["PATCH", "/api/suppliers/:id", writers],
      ["GET", "/api/products", "signed-in"],
      ["GET", "/api/products/:id", "signed-in"],
      ["POST", "/api/products", writers],
      ["PATCH", "/api/products/:id", writers],
      ["GET", "/api/supplier-products", "signed-in"],
      ["GET", "/api/supplier-products/:id", "signed-in"],
      ["POST", "/api/supplier-products", writers],
      ["PATCH", "/api/supplier-products/:id", writers],
    ]);
  });

  it("a create answers 201; everything else 200", () => {
    for (const [name, e] of Object.entries(endpoints)) {
      const status = "status" in e ? e.status : 200;
      expect(status, name).toBe(
        e.method === "POST" && name.startsWith("create") ? 201 : 200,
      );
    }
  });
});

describe("buildPath: a path with its parameters filled in", () => {
  it("leaves a path without parameters as it is", () => {
    expect(buildPath("/api/products", {})).toBe("/api/products");
  });

  it("encodes each value, so a slash or a space can't change the route", () => {
    expect(
      buildPath("/api/products/:id/units/:unit", { id: "a b/c", unit: "kg" }),
    ).toBe("/api/products/a%20b%2Fc/units/kg");
  });

  it("refuses a missing parameter, naming it", () => {
    expect(() => buildPath("/api/products/:id", {})).toThrow(
      'missing path parameter "id"',
    );
  });

  it("any values: reading the built path back gives the same values", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (id, unit) => {
          const pattern = "/api/products/:id/units/:unit";
          const path = buildPath(pattern, { id, unit });
          expect(readPath(pattern, path)).toEqual({ id, unit });
        },
      ),
    );
  });
});
