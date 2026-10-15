import { ProductList } from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { products, users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { testConfig } from "../test/helpers";

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${products}, verifications cascade`);
  await db.insert(products).values([
    { name: "Tomato", baseUnit: "g" },
    { name: "Eggs", baseUnit: "unit" },
    { name: "Olive oil", baseUnit: "ml" },
    { name: "Saffron (discontinued)", baseUnit: "g", active: false },
  ]);
});

describe("GET /api/products", () => {
  it("needs a session → 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/products" });
    expect(response.statusCode).toBe(401);
  });

  it.each(["counter", "office"] as const)(
    "%s sees the active products, sorted by name",
    async (role) => {
      const cookie = await signedInAs(app, auth, role);
      const response = await app.inject({
        method: "GET",
        url: "/api/products",
        headers: { cookie },
      });

      expect(response.statusCode).toBe(200);
      const body = ProductList.parse(response.json());
      expect(body.products.map((p) => [p.name, p.baseUnit])).toEqual([
        ["Eggs", "unit"],
        ["Olive oil", "ml"],
        ["Tomato", "g"],
      ]);
    },
  );
});
