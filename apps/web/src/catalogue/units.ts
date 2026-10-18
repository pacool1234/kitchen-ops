// A conversion's size, typed the way a kitchen says it (#89): in kilos, litres or units. Each is
// 1000 base units, since a base unit is a gram, a millilitre or a thousandth of a unit (spec
// section 4). Worked out on the decimal text, never with a JavaScript number's fractions.

const AMOUNT = /^(\d+)(?:\.(\d{1,3}))?$/;
const QUANTITY = /^(\d+)(?:\.(\d{1,6}))?$/;

/** "6" kg is 6000 g; "0.25" is 250. Undefined if it isn't a decimal with up to 3 places. */
export function amountToFactor(amount: string): number | undefined {
  const match = AMOUNT.exec(amount.trim());
  if (!match) return undefined;
  const [, whole = "0", fraction = ""] = match;
  const factor = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  return factor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(factor) : undefined;
}

/** 6000 base units as typed: "6"; 250 is "0.25". */
export function factorToAmount(factor: number): string {
  const whole = Math.floor(factor / 1000);
  const fraction = String(factor % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * A pack in base units: "2.5" dozen of 12 000 is 30 000. Null if the quantity isn't a decimal
 * with up to 6 places, or the pack isn't a whole number of base units (the API refuses it).
 */
export function packBaseUnits(quantity: string, factor: number): number | null {
  const match = QUANTITY.exec(quantity.trim());
  if (!match) return null;
  const [, whole = "0", fraction = ""] = match;
  const millionths =
    BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  const exact = millionths * BigInt(factor);
  if (exact % 1_000_000n !== 0n) return null;
  const baseUnits = exact / 1_000_000n;
  return baseUnits <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(baseUnits)
    : null;
}
