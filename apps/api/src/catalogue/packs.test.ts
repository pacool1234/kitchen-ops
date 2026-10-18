import { toBaseUnits } from "@kitchen-ops/ledger";
import {
  MAX_FACTOR,
  MAX_PACK_QUANTITY,
  Product,
  Supplier,
  SupplierProduct,
} from "@kitchen-ops/shared";
import fc from "fast-check";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { products, suppliers, users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { apiAs, syntheticCif } from "../test/catalogue";
import { testConfig } from "../test/helpers";

// A unit conversion turns purchase units into base units exactly as packages/ledger does (#88):
// whatever the factor and the pack, the API's packBaseUnits is the ledger's toBaseUnits, and the
// API refuses exactly the packs the ledger can't convert to a whole number of base units.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

let api: ReturnType<typeof apiAs>;
let supplier: Supplier;
beforeAll(async () => {
  await db.execute(
    sql`truncate ${users}, ${products}, ${suppliers}, verifications cascade`,
  );
  api = apiAs(app, await signedInAs(app, auth, "office"));
  supplier = await api.created(
    "/api/suppliers",
    { name: "Proveedor", taxId: syntheticCif(1) },
    Supplier,
  );
});

// Factors people use (a kilo, a box, a bottle, a dozen eggs) and any other up to the limit.
const factor = fc.oneof(
  fc.constantFrom(1, 750, 1000, 6000, 12_000, 25_000),
  fc.integer({ min: 1, max: MAX_FACTOR }),
);

// Up to 6 decimals, up to the limit: whole numbers, simple fractions, and any millionths.
const MILLION = 1_000_000n;
const quantity = fc
  .oneof(
    fc.bigInt({ min: 1n, max: 1000n }).map((n) => n * MILLION),
    fc.constantFrom(500_000n, 250_000n, 1_500_000n, 1000n, 1n),
    fc.bigInt({ min: 1n, max: BigInt(MAX_PACK_QUANTITY) * MILLION }),
  )
  .map((millionths) => {
    const whole = millionths / MILLION;
    const fraction = (millionths % MILLION)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : `${whole}`;
  });

/** What the ledger makes of it: the base units, or null if it refuses. */
function ledgerBaseUnits(productId: string, quantity: string, factor: number) {
  try {
    return toBaseUnits({ productId, quantity, unit: "caja" }, [
      { productId, unit: "caja", factor },
    ]);
  } catch {
    return null;
  }
}

describe("packs and unit conversions (#88)", () => {
  it("the API's pack in base units is the ledger's, and it refuses exactly what the ledger refuses", async () => {
    await fc.assert(
      fc.asyncProperty(factor, quantity, async (f, q) => {
        await db.execute(sql`truncate ${products} cascade`);
        const product = await api.created(
          "/api/products",
          {
            name: "Producto",
            baseUnit: "g",
            category: "other",
            conversions: [{ unit: "caja", factor: f }],
          },
          Product,
        );
        // The factor is stored as it was sent.
        expect(product.conversions).toEqual([{ unit: "caja", factor: f }]);

        const response = await api.send("POST", "/api/supplier-products", {
          supplierId: supplier.id,
          code: "P",
          description: "Producto, caja",
          productId: product.id,
          pack: { quantity: q, unit: "caja" },
        });
        const expected = ledgerBaseUnits(product.id, q, f);
        if (expected === null) {
          expect(response.statusCode, response.body).toBe(400);
          expect(response.json()).toEqual({
            error: "invalid_input",
            fields: { "pack.quantity": "not_whole_base_units" },
          });
        } else {
          expect(response.statusCode, response.body).toBe(201);
          expect(SupplierProduct.parse(response.json()).packBaseUnits).toBe(
            expected,
          );
        }
      }),
      { numRuns: 60 },
    );
  });
});
