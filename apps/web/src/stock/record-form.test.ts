import type { Product } from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { factorToAmount } from "../catalogue/units";
import { canonicalDecimal } from "../components/ui/number";
import {
  KITCHEN_UNIT,
  lineErrors,
  sendsOnce,
  stockLine,
  unitChoices,
} from "./record-form";

// Waste and transfers typed the way a kitchen says them (#151): in kilos, litres or units, or in
// one of the product's purchase units; sent as the API takes them, in base units or as typed.

const product = (
  baseUnit: Product["baseUnit"],
  conversions: Product["conversions"] = [],
): Product => ({
  id: `0199a000-0000-7000-8000-00000000000${baseUnit.length}`,
  name: "Producto",
  baseUnit,
  category: "other",
  defaultStoreroomId: null,
  active: true,
  conversions,
});
const tomato = product("g", [
  { unit: "kg", factor: 1000 },
  { unit: "caja", factor: 6000 },
]);
const oil = product("ml", [{ unit: "garrafa", factor: 5000 }]);
const lemons = product("unit", [{ unit: "malla", factor: 12_000 }]);

describe("unitChoices", () => {
  it("kilos, litres or units first, then the product's purchase units; a purchase unit that's the same kilo isn't offered twice", () => {
    expect(unitChoices(tomato)).toEqual([
      { value: KITCHEN_UNIT, factor: 1000 },
      { value: "caja", factor: 6000 },
    ]);
    expect(unitChoices(oil)).toEqual([
      { value: KITCHEN_UNIT, factor: 1000 },
      { value: "garrafa", factor: 5000 },
    ]);
    expect(unitChoices(lemons)).toEqual([
      { value: KITCHEN_UNIT, factor: 1000 },
      { value: "malla", factor: 12_000 },
    ]);
  });
});

describe("stockLine", () => {
  const line = (quantity: string, unit: string, productId = tomato.id) => ({
    productId,
    quantity,
    unit,
  });

  it("1.5 kg of tomatoes goes as 1500 g, 0.25 l of oil as 250 ml: whole base units", () => {
    expect(stockLine(line("1.5", KITCHEN_UNIT), tomato)).toEqual(
      line("1500", "g"),
    );
    expect(stockLine(line("0.25", KITCHEN_UNIT, oil.id), oil)).toEqual(
      line("250", "ml", oil.id),
    );
  });

  it("units go as typed, in the base unit: the API counts thousandths of one", () => {
    expect(stockLine(line("3", KITCHEN_UNIT, lemons.id), lemons)).toEqual(
      line("3", "unit", lemons.id),
    );
  });

  it("a purchase unit goes as typed: the API converts it", () => {
    expect(stockLine(line("2", "caja"), tomato)).toEqual(line("2", "caja"));
  });

  it("no product chosen yet: as typed, for the schema to refuse", () => {
    expect(stockLine(line("1", KITCHEN_UNIT, ""), undefined)).toEqual(
      line("1", KITCHEN_UNIT, ""),
    );
  });

  it("any quantity in kilos, sent in grams, is what was typed, read back in kilos (property)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.integer({ min: 0, max: 3 }),
        (millis, places) => {
          // A quantity with up to 3 decimals, written as a kitchen might: "1.500", "0.25", "7".
          const whole = millis / 1000n;
          const fraction = String(millis % 1000n)
            .padStart(3, "0")
            .slice(0, places);
          const typed = places > 0 ? `${whole}.${fraction}` : String(whole);
          const sent = stockLine(line(typed, KITCHEN_UNIT), tomato);
          expect(sent.unit).toBe("g");
          expect(sent.quantity).toMatch(/^\d+$/);
          expect(factorToAmount(Number(sent.quantity))).toBe(
            canonicalDecimal(typed),
          );
        },
      ),
    );
  });
});

describe("lineErrors", () => {
  const products = new Map([tomato, oil].map((p) => [p.id, p]));

  it("a quantity that isn't a whole number of base units is refused on its field before sending", () => {
    expect(
      lineErrors(
        [
          { productId: tomato.id, quantity: "1.5", unit: KITCHEN_UNIT },
          { productId: tomato.id, quantity: "1.2345", unit: KITCHEN_UNIT },
          { productId: oil.id, quantity: "0.0001", unit: "garrafa" },
          { productId: oil.id, quantity: "0.0002", unit: "garrafa" },
        ],
        products,
      ),
    ).toEqual({
      "lines.1.quantity": "not_whole_base_units",
      "lines.2.quantity": "not_whole_base_units",
    });
  });

  it("leaves to the schema what's missing: no product, no quantity, no unit", () => {
    expect(
      lineErrors(
        [
          { productId: "", quantity: "1", unit: KITCHEN_UNIT },
          { productId: tomato.id, quantity: "", unit: KITCHEN_UNIT },
          { productId: tomato.id, quantity: "1", unit: "" },
        ],
        products,
      ),
    ).toEqual({});
  });
});

describe("sendsOnce", () => {
  it("sends again under the same ID until one is answered, so a lost answer posts once; then a new one", async () => {
    let n = 0;
    const ids = ["first", "second"];
    const seen: string[] = [];
    let fail = true;
    const recording = sendsOnce(
      async (id) => {
        seen.push(id);
        if (fail) throw new Error("timeout");
        return `posted ${id}`;
      },
      () => ids[n++]!,
    );
    await expect(recording.send()).rejects.toThrow("timeout");
    await expect(recording.send()).rejects.toThrow("timeout");
    fail = false;
    expect(recording.id).toBe("first");
    await expect(recording.send()).resolves.toBe("posted first");
    expect(seen).toEqual(["first", "first", "first"]);
    expect(recording.id).toBe("second");
  });
});
