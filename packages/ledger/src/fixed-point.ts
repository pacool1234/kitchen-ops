/**
 * Fixed-point amounts: a `bigint` counting the smallest unit, `scale` decimal places below 1.
 * At scale 2, €12.50 is 1250n. See decision 0015.
 *
 * Used by the ledger's own types (Money, UnitCost); not exported from the package.
 */

// An optional minus, digits, and optionally a point followed by digits. Nothing else: no plus
// sign, exponent, spaces or thousands separators.
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Reads a decimal string such as "12.50" as a whole number of the smallest unit (1250n at
 * scale 2). Throws a RangeError for anything else, including more decimal places than `scale`:
 * those are rejected, never rounded.
 */
export function parseFixed(text: string, scale: number, name: string): bigint {
  const match = DECIMAL.exec(text);
  if (!match) {
    throw new RangeError(
      `${name} must be a decimal number such as "12.50", got ${JSON.stringify(text)}`,
    );
  }
  const [, sign, whole = "", fraction = ""] = match;
  if (fraction.length > scale) {
    throw new RangeError(
      `${name} has more than ${scale} decimal places: ${JSON.stringify(text)}`,
    );
  }
  const value = BigInt(whole + fraction.padEnd(scale, "0"));
  return sign ? -value : value;
}

/** Writes an amount with every decimal place: 1250n at scale 2 is "12.50", -5n is "-0.05". */
export function formatFixed(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${whole}${scale > 0 ? `.${fraction}` : ""}`;
}

/**
 * The ledger's one rounding function: numerator ÷ divisor, rounded to a whole number, ties
 * away from zero (2.5 → 3, -2.5 → -3), as on Spanish invoices. Every rounding point listed
 * in decision 0015 goes through here.
 */
export function roundDiv(numerator: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) {
    throw new RangeError(`divisor must be positive, got ${divisor}`);
  }
  // bigint division truncates towards zero, and the remainder has the numerator's sign.
  const quotient = numerator / divisor;
  const remainder = numerator % divisor;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  // At least half of the divisor left over: one more unit, away from zero.
  if (2n * absRemainder >= divisor) {
    return quotient + (numerator < 0n ? -1n : 1n);
  }
  return quotient;
}
