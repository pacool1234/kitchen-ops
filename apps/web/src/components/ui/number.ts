import type { Locale } from "@kitchen-ops/shared";

// What a number field holds (#85): a decimal string such as "2.5", never a JavaScript number,
// so a quantity or a price is never rounded on its way in (CLAUDE.md).

export type DecimalInput =
  | { ok: true; value: string }
  | { ok: false; error: "invalid" | "tooManyDecimals" | "negative" };

/** What a person may type: a sign, digits, and one comma or point. No thousands separators. */
const TYPED = /^(-?)(\d*)(?:[.,](\d*))?$/;

/** A decimal written one way only: no leading zeros, no trailing decimal zeros, no "-0". */
export function canonicalDecimal(decimal: string): string {
  const negative = decimal.startsWith("-");
  const [whole = "", fraction = ""] = decimal.replace("-", "").split(".");
  const integer = whole.replace(/^0+(?=\d)/, "") || "0";
  const decimals = fraction.replace(/0+$/, "");
  const zero = integer === "0" && decimals === "";
  return `${negative && !zero ? "-" : ""}${integer}${decimals ? `.${decimals}` : ""}`;
}

/**
 * What was typed in a number field, as a decimal string: "2,5" and "2.5" are both "2.5", in
 * either language. Grouping such as "1.234,5" is refused: "1.234" alone could be either
 * 1234 or 1.234, and a wrong guess changes a quantity a thousandfold. Never rounds.
 */
export function parseDecimalInput(
  text: string,
  options: { maxDecimals: number; allowNegative: boolean },
): DecimalInput {
  const typed = text.trim();
  if (typed === "") return { ok: true, value: "" };

  const match = TYPED.exec(typed);
  const [, sign = "", whole = "", fraction = ""] = match ?? [];
  if (!match || (whole === "" && fraction === "")) {
    return { ok: false, error: "invalid" };
  }
  const value = canonicalDecimal(`${sign}${whole || "0"}.${fraction}`);
  if (value.startsWith("-") && !options.allowNegative) {
    return { ok: false, error: "negative" };
  }
  if ((value.split(".")[1] ?? "").length > options.maxDecimals) {
    return { ok: false, error: "tooManyDecimals" };
  }
  return { ok: true, value };
}

/** A decimal string as a number field shows it: "1234,5" in Spanish. Ungrouped, to edit. */
export function formatDecimalInput(value: string, locale: Locale): string {
  return locale === "es" ? value.replace(".", ",") : value;
}
