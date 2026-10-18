import type { BaseUnit, Locale } from "@kitchen-ops/shared";

// How amounts are shown in each interface language (#86). They arrive as a bigint or a decimal
// string and reach Intl as a string, which it formats exactly, digit by digit: money never
// becomes a JavaScript number (CLAUDE.md), so no amount loses precision, however large.

/** The Intl locale behind each interface language. English is British: €1,234.56, 18/10/2026. */
const INTL_LOCALE: Record<Locale, string> = { es: "es-ES", en: "en-GB" };

/** The restaurant's time zone: every time is shown in it, whatever the device's (decision 0020). */
export const RESTAURANT_TIME_ZONE = "Europe/Madrid";

/** Between an amount and its unit, as Intl writes it: "2,5 kg", "18,50 €". */
const NBSP = "\u00a0";

const DECIMAL = /^-?\d+(?:\.(\d+))?$/;

/** Checks that `text` is a decimal with at most `maxDecimals` decimals. Never rounds. */
function checkedDecimal(
  text: string,
  maxDecimals: number,
  what: string,
): Intl.StringNumericLiteral {
  const match = DECIMAL.exec(text);
  if (!match) {
    throw new RangeError(
      `${what} must be a decimal such as "12.50", got ${JSON.stringify(text)}`,
    );
  }
  if ((match[1]?.length ?? 0) > maxDecimals) {
    throw new RangeError(
      `${what} has more than ${maxDecimals} decimals: ${JSON.stringify(text)}`,
    );
  }
  return text as Intl.StringNumericLiteral;
}

/** A whole number of the smallest unit as a decimal: 123456n at 2 places is "1234.56". */
function scaled(units: bigint, places: number): Intl.StringNumericLiteral {
  const sign = units < 0n ? "-" : "";
  const digits = (units < 0n ? -units : units)
    .toString()
    .padStart(places + 1, "0");
  return `${sign}${digits.slice(0, -places)}.${digits.slice(-places)}` as Intl.StringNumericLiteral;
}

/** The decimal point moved 3 places right, exactly: "0.0185" is "18.5". */
function timesThousand(text: string): Intl.StringNumericLiteral {
  const sign = text.startsWith("-") ? "-" : "";
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const padded = fraction.padEnd(3, "0");
  const integer = (whole! + padded.slice(0, 3)).replace(/^0+(?=\d)/, "");
  const rest = padded.slice(3);
  return `${sign}${integer}${rest ? `.${rest}` : ""}` as Intl.StringNumericLiteral;
}

const formats = new Map<string, Intl.NumberFormat>();

/** One Intl.NumberFormat per locale and options, kept: building one is slow. */
function numberFormat(
  locale: Locale,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${locale} ${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    // "always": es-ES leaves 4-digit amounts ungrouped (1234,56 €); a column of amounts reads
    // better grouped the same way throughout (1.234,56 €).
    format = new Intl.NumberFormat(INTL_LOCALE[locale], {
      useGrouping: "always",
      ...options,
    });
    formats.set(key, format);
  }
  return format;
}

const EURO: Intl.NumberFormatOptions = {
  style: "currency",
  currency: "EUR",
  // No "-0,00 €" for a decimal string such as "-0.00".
  signDisplay: "negative",
};

/** Euros, from whole cents or the API's decimal string: `1.234,56 €`, `€1,234.56`. */
export function formatMoney(amount: bigint | string, locale: Locale): string {
  const value =
    typeof amount === "bigint"
      ? scaled(amount, 2)
      : checkedDecimal(amount, 2, "an amount of money");
  return numberFormat(locale, EURO).format(value);
}

/** The unit a base unit's cost is shown per: a kilo, a litre, or a whole unit. */
const COST_UNIT: Record<Locale, Record<BaseUnit, string>> = {
  es: { g: "kg", ml: "l", unit: "ud." },
  en: { g: "kg", ml: "l", unit: "unit" },
};

/**
 * A cost per base unit (up to 6 decimals) as a cost per kilo, litre or unit: 0.0185 €/g is
 * `18,50 €/kg`. A base unit is a gram, a millilitre or a thousandth of a unit, so this is always
 * 1000 times the cost, which moves the decimal point and loses nothing.
 */
export function formatUnitCost(
  costPerBaseUnit: string,
  baseUnit: BaseUnit,
  locale: Locale,
): string {
  const perThousand = timesThousand(
    checkedDecimal(costPerBaseUnit, 6, "a unit cost"),
  );
  const amount = numberFormat(locale, {
    ...EURO,
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(perThousand);
  return `${amount}/${COST_UNIT[locale][baseUnit]}`;
}

/** What a whole unit is called: one, or more (or a part) of them. */
const UNIT_NAME: Record<Locale, { one: string; other: string }> = {
  es: { one: "ud.", other: "uds." },
  en: { one: "unit", other: "units" },
};

/**
 * A quantity in base units (decision 0010) the way a kitchen says it: 1000 g or more in kilos
 * (`2,5 kg`), 1000 ml or more in litres, and units counted from thousandths (`3 uds.`).
 */
export function formatQuantity(
  quantity: number,
  baseUnit: BaseUnit,
  locale: Locale,
): string {
  if (!Number.isSafeInteger(quantity)) {
    throw new RangeError(
      `a quantity must be a whole number of base units, got ${quantity}`,
    );
  }
  const number = numberFormat(locale, { maximumFractionDigits: 3 });
  const thousandths = number.format(scaled(BigInt(quantity), 3));

  if (baseUnit === "unit") {
    const names = UNIT_NAME[locale];
    // Spanish and English say "1 ud.", "1 unit", and the plural for any other amount.
    const name = Math.abs(quantity) === 1000 ? names.one : names.other;
    return `${thousandths}${NBSP}${name}`;
  }
  // The symbols are the same in every language. Written here, not by Intl's "unit" style,
  // whose space before the symbol differs from the one before "€" and "%".
  const [small, large] = baseUnit === "g" ? ["g", "kg"] : ["ml", "l"];
  return Math.abs(quantity) >= 1000
    ? `${thousandths}${NBSP}${large}`
    : `${number.format(BigInt(quantity))}${NBSP}${small}`;
}

/** A calendar date, "2026-10-18", as `18/10/2026`. It never moves a day with the time zone. */
export function formatDate(date: string, locale: Locale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const [year, month, day] = (match ?? []).slice(1).map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day));
  if (
    !match ||
    value.getUTCMonth() !== month! - 1 ||
    value.getUTCDate() !== day
  ) {
    throw new RangeError(
      `a date must be YYYY-MM-DD, got ${JSON.stringify(date)}`,
    );
  }
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

/** A moment, an ISO timestamp, in the restaurant's time: `18/10/2026, 20:05`. */
export function formatDateTime(instant: string, locale: Locale): string {
  const value = new Date(instant);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(instant) || Number.isNaN(value.getTime())) {
    throw new RangeError(
      `a moment must be an ISO timestamp, got ${JSON.stringify(instant)}`,
    );
  }
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: RESTAURANT_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

/** A percentage as the API sends it, "5.5" for 5.5 %, with its decimals: `5,5 %`. */
export function formatPercent(percent: string, locale: Locale): string {
  return numberFormat(locale, {
    style: "unit",
    unit: "percent",
    maximumFractionDigits: 2,
  }).format(checkedDecimal(percent, 2, "a percentage"));
}
