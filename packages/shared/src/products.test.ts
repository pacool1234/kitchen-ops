import { describe, expect, it } from "vitest";
import {
  BASE_UNIT_FACTOR,
  checkConversions,
  MAX_FACTOR,
  NewProduct,
  ProductChanges,
} from "./products";

// Products and their unit conversions (#88), as forms send them.

const issues = (result: {
  error?: { issues: { code: string; path: PropertyKey[] }[] };
}) => result.error?.issues.map((i) => [i.code, i.path.join(".")]);

describe("NewProduct", () => {
  it("trims the name, and a product without conversions has none", () => {
    expect(
      NewProduct.parse({
        name: " Tomate pera ",
        baseUnit: "g",
        category: "produce",
      }),
    ).toEqual({
      name: "Tomate pera",
      baseUnit: "g",
      category: "produce",
      conversions: [],
    });
  });

  it("refuses a factor that isn't a positive whole number of base units, or is too big", () => {
    const result = NewProduct.safeParse({
      name: "Tomate pera",
      baseUnit: "g",
      category: "produce",
      conversions: [
        { unit: "caja", factor: 0 },
        { unit: "kg", factor: 1.5 },
        { unit: "palé", factor: MAX_FACTOR + 1 },
        { unit: " ", factor: 1000 },
      ],
    });
    expect(issues(result)).toEqual([
      ["too_small", "conversions.0.factor"],
      ["invalid_type", "conversions.1.factor"],
      ["too_big", "conversions.2.factor"],
      ["too_small", "conversions.3.unit"],
    ]);
  });

  it("refuses a category it doesn't know", () => {
    expect(
      NewProduct.safeParse({ name: "Tomate", baseUnit: "g", category: "veg" })
        .success,
    ).toBe(false);
  });
});

describe("ProductChanges", () => {
  it("holds only what was sent: conversions not sent stay as they are", () => {
    expect(Object.keys(ProductChanges.parse({ name: "Tomate rama" }))).toEqual([
      "name",
    ]);
  });

  it("refuses a base unit: it's set when the product is created, and never changes", () => {
    expect(issues(ProductChanges.safeParse({ baseUnit: "ml" }))).toEqual([
      ["unrecognized_keys", ""],
    ]);
  });
});

describe("checkConversions", () => {
  it("every unit once, whatever its case: a second one is taken", () => {
    expect(
      checkConversions("g", [
        { unit: "caja", factor: 6000 },
        { unit: "kg", factor: 1000 },
        { unit: "Caja", factor: 5000 },
      ]),
    ).toEqual({ "conversions.2.unit": "taken" });
  });

  it("the base unit's own name is reserved: the API adds it, at its own factor", () => {
    expect(
      checkConversions("unit", [
        { unit: "docena", factor: 12_000 },
        { unit: "Unit", factor: 1000 },
      ]),
    ).toEqual({ "conversions.1.unit": "reserved" });
    expect(BASE_UNIT_FACTOR).toEqual({ g: 1, ml: 1, unit: 1000 });
  });

  it("a list without either is fine", () => {
    expect(checkConversions("ml", [{ unit: "botella", factor: 750 }])).toEqual(
      {},
    );
  });
});
