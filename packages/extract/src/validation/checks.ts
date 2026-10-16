import {
  formatMoney,
  lineTotal,
  parseMoney,
  parseUnitCost,
  percentageOf,
  sumMoney,
  type Money,
} from "@kitchen-ops/ledger";
import type { ExtractedDocument, ExtractedLine } from "@kitchen-ops/shared";
import { checkSpanishTaxId } from "./tax-id";

// The checks a result must pass before it is trusted (spec section 5, stage 4). Anything that
// fails goes to review, with the failing check named. Arithmetic uses the ledger's own rules
// (decision 0016), so a result that passes here is posted at the same amounts.

/** Every check, by name. Names and paths never contain document contents; messages may. */
export const CHECKS = [
  "missing-value",
  "line-total",
  "lines-sum",
  "vat",
  "total",
  "tax-id",
  "date",
  "duplicate",
] as const;
export type CheckName = (typeof CHECKS)[number];

export interface CheckFailure {
  readonly check: CheckName;
  /** The field, as in the schema: "lines.0.lineTotal", "totals.vat.1.amount". */
  readonly path: string;
  /** For the review screen. May show values from the document. */
  readonly message: string;
}

/** What the checks need besides the document. Passed in, so the checks stay pure. */
export interface ValidationContext {
  /** Today, as YYYY-MM-DD. */
  readonly today: string;
  /** How old a document may be, in days. */
  readonly maxAgeDays: number;
  /** Numbers of this supplier's documents already received. */
  readonly knownNumbers: readonly string[];
}

export interface ValidationResult {
  readonly passed: boolean;
  readonly failures: readonly CheckFailure[];
}

/** Runs every check on one result. */
export function validate(
  document: ExtractedDocument,
  context: ValidationContext,
): ValidationResult {
  const failures = [
    ...missingValues(document),
    ...lineTotals(document),
    ...linesSum(document),
    ...vat(document),
    ...total(document),
    ...taxId(document),
    ...date(document, context),
    ...duplicate(document, context),
  ];
  return { passed: failures.length === 0, failures };
}

const fail = (
  check: CheckName,
  path: string,
  message: string,
): CheckFailure => ({ check, path, message });

/** Every value in the list is present. */
function present<T>(values: readonly (T | null)[]): values is T[] {
  return values.every((value) => value !== null);
}

const money = (amount: Money) => formatMoney(amount);

/** "10" and "10.00" are the same rate. Rates aren't money, so a number is fine here. */
const sameRate = (a: string, b: string) => Number(a) === Number(b);

/**
 * Values the rest of the pipeline needs. Every document: the tax ID (to find the supplier), the
 * number and date, and each line's quantity, unit and a description or code. Invoices also need
 * their totals and each line's price, VAT rate and total.
 */
function missingValues(document: ExtractedDocument): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const missing = (path: string, what = "required") =>
    failures.push(fail("missing-value", path, what));

  if (document.supplier.taxId === null) missing("supplier.taxId");
  if (document.number === null) missing("number");
  if (document.issueDate === null) missing("issueDate");
  document.lines.forEach((line, i) => {
    if (line.quantity === null) missing(`lines.${i}.quantity`);
    if (line.unit === null) missing(`lines.${i}.unit`);
    if (line.description === null && line.supplierCode === null) {
      missing(
        `lines.${i}.description`,
        "needs a description or a supplier code",
      );
    }
  });

  if (document.documentType === "invoice") {
    const { totals } = document;
    if (totals === null) {
      missing("totals", "required on an invoice");
    } else {
      if (totals.net === null) missing("totals.net", "required on an invoice");
      if (totals.total === null)
        missing("totals.total", "required on an invoice");
      totals.vat.forEach((row, i) => {
        for (const field of ["rate", "base", "amount"] as const) {
          if (row[field] === null)
            missing(`totals.vat.${i}.${field}`, "required on an invoice");
        }
      });
    }
    document.lines.forEach((line, i) => {
      for (const field of ["unitPrice", "vatRate", "lineTotal"] as const) {
        if (line[field] === null)
          missing(`lines.${i}.${field}`, "required on an invoice");
      }
    });
  }
  return failures;
}

/** quantity × unit price − discount, exactly as the ledger posts it. */
function computedLineTotal(line: ExtractedLine): Money | null {
  if (line.quantity === null || line.unitPrice === null) return null;
  return lineTotal({
    quantity: line.quantity,
    unitPrice: parseUnitCost(line.unitPrice),
    ...(line.discountPercent === null
      ? {}
      : { discountPercent: line.discountPercent }),
  });
}

function lineTotals(document: ExtractedDocument): CheckFailure[] {
  return document.lines.flatMap((line, i) => {
    const computed = computedLineTotal(line);
    if (computed === null || line.lineTotal === null) return [];
    if (computed === parseMoney(line.lineTotal)) return [];
    const discount =
      line.discountPercent === null ? "" : ` less ${line.discountPercent}%`;
    return [
      fail(
        "line-total",
        `lines.${i}.lineTotal`,
        `${line.quantity} × ${line.unitPrice}${discount} is ${money(computed)}, but the line says ${line.lineTotal}`,
      ),
    ];
  });
}

function linesSum(document: ExtractedDocument): CheckFailure[] {
  const net = document.totals?.net ?? null;
  const totals = document.lines.map((line) => line.lineTotal);
  if (net === null || !present(totals)) return [];
  const sum = sumMoney(totals.map(parseMoney));
  return sum === parseMoney(net)
    ? []
    : [
        fail(
          "lines-sum",
          "totals.net",
          `the lines add up to ${money(sum)}, but the net says ${net}`,
        ),
      ];
}

/**
 * VAT. The bases add up to the net; each rate's base is the sum of its lines; each amount is
 * base × rate in one of the two ways Spanish invoices work it out: on the base, rounded once, or
 * line by line, each rounded, then added up.
 */
function vat(document: ExtractedDocument): CheckFailure[] {
  const { totals, lines } = document;
  if (totals === null || totals.vat.length === 0) return [];
  const failures: CheckFailure[] = [];

  const bases = totals.vat.map((row) => row.base);
  if (totals.net !== null && present(bases)) {
    const sum = sumMoney(bases.map(parseMoney));
    if (sum !== parseMoney(totals.net)) {
      failures.push(
        fail(
          "vat",
          "totals.vat",
          `the VAT bases add up to ${money(sum)}, but the net says ${totals.net}`,
        ),
      );
    }
  }

  // Line by line needs every line's rate and total.
  const linesKnown = lines.every(
    (l) => l.vatRate !== null && l.lineTotal !== null,
  );
  totals.vat.forEach((row, i) => {
    if (row.rate === null) return;
    const rate = row.rate;
    const atRate = lines.filter(
      (l) => l.vatRate !== null && sameRate(l.vatRate, rate),
    );

    if (linesKnown && row.base !== null) {
      const sum = sumMoney(atRate.map((l) => parseMoney(l.lineTotal ?? "0")));
      if (sum !== parseMoney(row.base)) {
        failures.push(
          fail(
            "vat",
            `totals.vat.${i}.base`,
            `the lines at ${rate}% add up to ${money(sum)}, but the base says ${row.base}`,
          ),
        );
      }
    }

    if (row.base !== null && row.amount !== null) {
      const onBase = percentageOf(parseMoney(row.base), rate);
      const byLine =
        linesKnown && atRate.length > 0
          ? sumMoney(
              atRate.map((l) =>
                percentageOf(parseMoney(l.lineTotal ?? "0"), rate),
              ),
            )
          : null;
      const amount = parseMoney(row.amount);
      if (amount !== onBase && amount !== byLine) {
        const alternative =
          byLine === null || byLine === onBase
            ? ""
            : ` (${money(byLine)} line by line)`;
        failures.push(
          fail(
            "vat",
            `totals.vat.${i}.amount`,
            `${rate}% of ${row.base} is ${money(onBase)}${alternative}, but the amount says ${row.amount}`,
          ),
        );
      }
    }
  });
  return failures;
}

function total(document: ExtractedDocument): CheckFailure[] {
  const { totals } = document;
  if (totals === null || totals.net === null || totals.total === null)
    return [];
  const amounts = totals.vat.map((row) => row.amount);
  if (!present(amounts)) return [];
  const sum = sumMoney([parseMoney(totals.net), ...amounts.map(parseMoney)]);
  return sum === parseMoney(totals.total)
    ? []
    : [
        fail(
          "total",
          "totals.total",
          `net plus VAT is ${money(sum)}, but the total says ${totals.total}`,
        ),
      ];
}

function taxId(document: ExtractedDocument): CheckFailure[] {
  const { taxId } = document.supplier;
  if (taxId === null) return [];
  const result = checkSpanishTaxId(taxId);
  return result.valid ? [] : [fail("tax-id", "supplier.taxId", result.reason)];
}

/** Days since 1970-01-01 for a YYYY-MM-DD date. No clock: `today` is passed in. */
function day(iso: string): number {
  const [year = 0, month = 1, dayOfMonth = 1] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, dayOfMonth) / 86_400_000;
}

function date(
  document: ExtractedDocument,
  context: ValidationContext,
): CheckFailure[] {
  if (document.issueDate === null) return [];
  const age = day(context.today) - day(document.issueDate);
  if (age < 0) {
    return [
      fail(
        "date",
        "issueDate",
        `${document.issueDate} is after today, ${context.today}`,
      ),
    ];
  }
  if (age > context.maxAgeDays) {
    return [
      fail(
        "date",
        "issueDate",
        `${document.issueDate} is ${age} days old, more than ${context.maxAgeDays}`,
      ),
    ];
  }
  return [];
}

/** Document numbers compared ignoring case and spaces: "f - 1" is "F-1". */
const normalizedNumber = (number: string) =>
  number.replace(/\s+/g, "").toUpperCase();

function duplicate(
  document: ExtractedDocument,
  context: ValidationContext,
): CheckFailure[] {
  if (document.number === null) return [];
  const number = normalizedNumber(document.number);
  return context.knownNumbers.some(
    (known) => normalizedNumber(known) === number,
  )
    ? [
        fail(
          "duplicate",
          "number",
          `${document.number} was already received from this supplier`,
        ),
      ]
    : [];
}
