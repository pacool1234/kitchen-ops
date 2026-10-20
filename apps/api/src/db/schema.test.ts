import type { MovementKind } from "@kitchen-ops/ledger";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as schema from "./schema";
import { MOVEMENT_KINDS, products } from "./schema";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A Drizzle client with no database behind it: builds SQL without running it.
const db = drizzle.mock({ schema });

describe("product IDs (decision 0011)", () => {
  it("are created by the API, not left to the database", () => {
    const query = db
      .insert(products)
      .values({ name: "Tomato", baseUnit: "g" })
      .toSQL();

    // The INSERT names the id column and sends a value for it.
    expect(query.sql).toMatch(/insert into "products" \("id",/);
    expect(query.params[0]).toMatch(UUID_V7);
  });

  // v7 orders by creation millisecond only: two IDs from the same millisecond can come in either
  // order, so this compares the 48-bit timestamp (first 12 hex digits), not the whole ID.
  it("are UUID v7, never going back in time", () => {
    const first = db
      .insert(products)
      .values({ name: "A", baseUnit: "g" })
      .toSQL().params[0] as string;
    const second = db
      .insert(products)
      .values({ name: "B", baseUnit: "g" })
      .toSQL().params[0] as string;

    expect(first).toMatch(UUID_V7);
    expect(second).toMatch(UUID_V7);
    const timestamp = (id: string) => id.replace("-", "").slice(0, 12);
    expect(timestamp(first) <= timestamp(second)).toBe(true);
  });

  it("keep an ID the caller already chose (e.g. a retried request)", () => {
    const id = "01a13cb0-abf6-72f3-87b9-f71110e63477";
    const query = db
      .insert(products)
      .values({ id, name: "Tomato", baseUnit: "g" })
      .toSQL();

    expect(query.params[0]).toBe(id);
  });
});

describe("movement kinds (decision 0034)", () => {
  it("are exactly packages/ledger's", () => {
    expectTypeOf<
      (typeof MOVEMENT_KINDS)[number]
    >().toEqualTypeOf<MovementKind>();
    expect(MOVEMENT_KINDS).toHaveLength(5);
  });
});
