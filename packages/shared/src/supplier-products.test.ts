import { describe, expect, it } from "vitest";
import {
  canonicalQuantity,
  MAX_PACK_QUANTITY,
  NewSupplierProduct,
  PackQuantity,
  SupplierProductChanges,
} from "./supplier-products";

// Supplier products (#88): how a supplier names and packs one of our products.

describe("PackQuantity: how much of a product's unit a pack holds", () => {
  it.each([
    ["25", "25"],
    [" 2.500 ", "2.5"],
    ["025", "25"],
    ["0.000001", "0.000001"],
    [String(MAX_PACK_QUANTITY), "100000"],
  ])("takes %j as %j", (written, quantity) => {
    expect(PackQuantity.parse(written)).toBe(quantity);
  });

  it.each([
    ["0", "too_small"],
    ["0.000000", "too_small"],
    ["100000.000001", "too_big"],
    ["1.1234567", "invalid_format"],
    ["-1", "invalid_format"],
    ["1e3", "invalid_format"],
    ["2,5", "invalid_format"],
    ["", "invalid_format"],
  ])("refuses %j: %s", (written, code) => {
    const result = PackQuantity.safeParse(written);
    expect(result.error?.issues.map((i) => i.code)).toEqual([code]);
  });

  it("canonicalQuantity writes a stored quantity as it's sent: no trailing zeros", () => {
    expect(canonicalQuantity("25.500000")).toBe("25.5");
    expect(canonicalQuantity("12.000000")).toBe("12");
    expect(canonicalQuantity("0.000001")).toBe("0.000001");
  });
});

describe("NewSupplierProduct and SupplierProductChanges", () => {
  const body = {
    supplierId: "0199a000-0000-7000-8000-000000000001",
    code: " TOM-6 ",
    description: " Tomate pera, caja 6 kg ",
    productId: "0199a000-0000-7000-8000-000000000002",
    pack: { quantity: "6", unit: "kg" },
  };

  it("trims the code and the description", () => {
    expect(NewSupplierProduct.parse(body)).toEqual({
      ...body,
      code: "TOM-6",
      description: "Tomate pera, caja 6 kg",
    });
  });

  it("a change can't move a supplier product to another supplier", () => {
    const result = SupplierProductChanges.safeParse({
      supplierId: body.supplierId,
    });
    expect(result.error?.issues.map((i) => i.code)).toEqual([
      "unrecognized_keys",
    ]);
  });
});
