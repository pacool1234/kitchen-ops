import { normalizedNumber } from "../validation/checks";

// How the eval decides that a value read from a document equals its gold answer (spec section 5,
// metrics). Only differences that don't change what the document says are ignored. null means
// "not printed", so it only ever equals null, except for a discount (`sameDiscount`).

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * A decimal string in one form per value: no leading zeros, no trailing decimal zeros, no minus
 * on zero. Done on the text, so no value is ever rounded through a JavaScript number. Anything
 * that isn't a decimal comes back unchanged.
 */
export function canonicalDecimal(value: string): string {
  const match = DECIMAL.exec(value);
  if (!match) return value;
  const [, sign = "", whole = "", fraction = ""] = match;
  const integer = whole.replace(/^0+(?=\d)/, "");
  const decimals = fraction.replace(/0+$/, "");
  if (integer === "0" && decimals === "") return "0";
  return `${sign}${integer}${decimals === "" ? "" : `.${decimals}`}`;
}

function same<T>(
  a: T | null,
  b: T | null,
  equal: (a: T, b: T) => boolean,
): boolean {
  return a === null || b === null ? a === b : equal(a, b);
}

/** "1.50" equals "1.5". */
export function sameDecimal(a: string | null, b: string | null): boolean {
  return same(a, b, (x, y) => canonicalDecimal(x) === canonicalDecimal(y));
}

/**
 * A blank discount column and 0% are the same discount: validation and the ledger post both as
 * no discount, so reading one for the other changes no stock figure (decision 0019). Discounts
 * only: a blank quantity or price read as 0 is still wrong.
 */
export function sameDiscount(a: string | null, b: string | null): boolean {
  return sameDecimal(a ?? "0", b ?? "0");
}

const plainText = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

/** Ignores case, spaces at the ends and runs of spaces. Accents and punctuation count. */
export function sameText(a: string | null, b: string | null): boolean {
  return same(a, b, (x, y) => plainText(x) === plainText(y));
}

/** The same calendar day. The schema already makes both YYYY-MM-DD. */
export function sameDate(a: string | null, b: string | null): boolean {
  return same(
    a,
    b,
    (x, y) => Date.parse(`${x}T00:00:00Z`) === Date.parse(`${y}T00:00:00Z`),
  );
}

/** As the duplicate check compares them, so the eval and the pipeline agree (#58). */
export function sameDocumentNumber(
  a: string | null,
  b: string | null,
): boolean {
  return same(a, b, (x, y) => normalizedNumber(x) === normalizedNumber(y));
}
