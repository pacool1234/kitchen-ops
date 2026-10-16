import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatFixed } from "./fixed-point";
import {
  addMoney,
  formatMoney,
  formatUnitCost,
  lineTotal,
  moneyFromCents,
  parseMoney,
  parseUnitCost,
  subtractMoney,
  sumMoney,
  unitCostFromMillionths,
  type Money,
} from "./money";

const cents = fc.oneof(
  { arbitrary: fc.constantFrom(0n, 1n, -1n), weight: 1 },
  { arbitrary: fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }), weight: 4 },
);
const money = cents.map(moneyFromCents);
const zero = moneyFromCents(0n);

describe("Money: whole cents", () => {
  it("parses and formats euros with exactly 2 decimals", () => {
    expect(parseMoney("12.50")).toBe(1250n);
    expect(formatMoney(parseMoney("12.5"))).toBe("12.50");
    expect(formatMoney(parseMoney("-0.05"))).toBe("-0.05");
  });

  it("rejects fractions of a cent instead of rounding them", () => {
    expect(() => parseMoney("12.505")).toThrow(RangeError);
  });

  it("formatting any amount and parsing the text back gives the same amount", () => {
    fc.assert(
      fc.property(money, (m) => {
        expect(parseMoney(formatMoney(m))).toBe(m);
      }),
    );
  });

  it("€10.20 + €0.51 = €10.71, €10.20 − €0.51 = €9.69, and €1 + €2 + €3 = €6", () => {
    expect(formatMoney(addMoney(parseMoney("10.20"), parseMoney("0.51")))).toBe(
      "10.71",
    );
    expect(
      formatMoney(subtractMoney(parseMoney("10.20"), parseMoney("0.51"))),
    ).toBe("9.69");
    expect(formatMoney(sumMoney(["1", "2", "3"].map(parseMoney)))).toBe("6.00");
    expect(sumMoney([])).toBe(zero);
  });

  it("adding money gives the same result in any order", () => {
    fc.assert(
      fc.property(money, money, (a, b) => {
        expect(addMoney(a, b)).toBe(addMoney(b, a));
      }),
    );
  });

  it("adding money gives the same result in any grouping", () => {
    fc.assert(
      fc.property(money, money, money, (a, b, c) => {
        expect(addMoney(addMoney(a, b), c)).toBe(addMoney(a, addMoney(b, c)));
      }),
    );
  });

  it("adding zero changes nothing", () => {
    fc.assert(
      fc.property(money, (a) => {
        expect(addMoney(a, zero)).toBe(a);
        expect(addMoney(zero, a)).toBe(a);
      }),
      { examples: [[zero]] },
    );
  });

  it("subtracting an amount undoes adding it", () => {
    fc.assert(
      fc.property(money, money, (a, b) => {
        expect(subtractMoney(addMoney(a, b), b)).toBe(a);
      }),
    );
  });

  it("a sum is the same as adding the amounts one by one", () => {
    fc.assert(
      fc.property(fc.array(money, { maxLength: 20 }), (amounts) => {
        expect(sumMoney(amounts)).toBe(
          amounts.reduce((total: Money, m) => addMoney(total, m), zero),
        );
      }),
    );
  });
});

describe("UnitCost: millionths of a euro", () => {
  it("parses and formats with exactly 6 decimals: €0.0185 per gram", () => {
    expect(parseUnitCost("0.0185")).toBe(18500n);
    expect(formatUnitCost(parseUnitCost("0.0185"))).toBe("0.018500");
    expect(formatUnitCost(unitCostFromMillionths(3_200_000n))).toBe("3.200000");
  });

  it("rejects a seventh decimal place instead of rounding it", () => {
    expect(() => parseUnitCost("0.0000001")).toThrow(RangeError);
  });

  it("formatting any unit cost and parsing the text back gives the same unit cost", () => {
    fc.assert(
      fc.property(cents, (millionths) => {
        const cost = unitCostFromMillionths(millionths);
        expect(parseUnitCost(formatUnitCost(cost))).toBe(cost);
      }),
    );
  });
});

describe("lineTotal: quantity × unit price − discount, rounded once to cents", () => {
  const total = (
    quantity: string,
    unitPrice: string,
    discountPercent?: string,
  ) =>
    formatMoney(
      lineTotal({
        quantity,
        unitPrice: parseUnitCost(unitPrice),
        ...(discountPercent === undefined ? {} : { discountPercent }),
      }),
    );

  it("2.5 kg × €3.20/kg = €8.00", () => {
    expect(total("2.5", "3.20")).toBe("8.00");
  });

  it("3 × €1.333333 = €3.999999, rounded once to €4.00", () => {
    expect(total("3", "1.333333")).toBe("4.00");
  });

  it("12 × €0.85 = €10.20, less 5% (€0.51) = €9.69", () => {
    expect(total("12", "0.85", "5")).toBe("9.69");
  });

  it("3 × €1.00 less 12.5% = €2.625, a tie, rounds up to €2.63", () => {
    expect(total("3", "1.00", "12.5")).toBe("2.63");
  });

  it("0.5 kg × €0.25/kg = €0.125, a tie, rounds up to €0.13", () => {
    expect(total("0.5", "0.25")).toBe("0.13");
  });

  it("a returned line, −0.5 kg × €0.25/kg = −€0.125, rounds away from zero to −€0.13", () => {
    expect(total("-0.5", "0.25")).toBe("-0.13");
  });

  it("rounds only the final total: 7 × €0.001428 = €0.009996 → €0.01 (rounding each unit first would give €0.00)", () => {
    expect(total("7", "0.001428")).toBe("0.01");
  });

  it("a 100% discount gives €0.00", () => {
    expect(total("4", "2.50", "100")).toBe("0.00");
  });

  it("rejects a discount below 0% or above 100%, or with more than 2 decimals", () => {
    expect(() => total("1", "1", "-1")).toThrow(RangeError);
    expect(() => total("1", "1", "100.01")).toThrow(RangeError);
    expect(() => total("1", "1", "5.555")).toThrow(RangeError);
  });

  it("rejects a quantity with more than 6 decimals", () => {
    expect(() => total("1.0000001", "1")).toThrow(RangeError);
  });

  it("a 0% discount gives the same total as no discount", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        (quantityMillionths, priceMillionths) => {
          const line = {
            quantity: formatFixed(quantityMillionths, 6),
            unitPrice: unitCostFromMillionths(priceMillionths),
          };
          expect(lineTotal({ ...line, discountPercent: "0" })).toBe(
            lineTotal(line),
          );
        },
      ),
    );
  });
});
