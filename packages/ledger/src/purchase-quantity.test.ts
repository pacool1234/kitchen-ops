import { describe, expect, it } from "vitest";
import { parsePurchaseQuantity } from "./purchase-quantity";

describe("parsePurchaseQuantity: a document line's quantity, in its purchase unit", () => {
  it("reads up to 6 decimals, in millionths of the purchase unit: 2.5 kg = 2 500 000", () => {
    expect(parsePurchaseQuantity("2.5")).toBe(2_500_000n);
    expect(parsePurchaseQuantity("12")).toBe(12_000_000n);
    expect(parsePurchaseQuantity("-0.000001")).toBe(-1n);
  });

  it("rejects a seventh decimal place, and anything that isn't a decimal number", () => {
    expect(() => parsePurchaseQuantity("1.0000001")).toThrow(RangeError);
    expect(() => parsePurchaseQuantity("two")).toThrow(/line quantity/);
  });
});
