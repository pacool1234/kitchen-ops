import type {
  ExtractedDocument,
  ExtractedLine,
  VatAmount,
} from "@kitchen-ops/shared";
import {
  sameDate,
  sameDecimal,
  sameDocumentNumber,
  sameText,
} from "./normalize";

// One extracted document against its gold answer (spec section 5, metrics): which header fields
// are right, which lines were found, and which fields of the found lines are right. The result
// names fields and lines by position, never their values, so it can be logged.

export const HEADER_FIELDS = [
  "documentType",
  "supplier.name",
  "supplier.taxId",
  "number",
  "issueDate",
  "totals.net",
  "totals.total",
  "totals.vat",
] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

export const LINE_FIELDS = [
  "supplierCode",
  "description",
  "quantity",
  "unit",
  "unitPrice",
  "discountPercent",
  "vatRate",
  "lineTotal",
] as const;
export type LineField = (typeof LINE_FIELDS)[number];

export interface DocumentComparison {
  readonly header: Readonly<Record<HeaderField, boolean>>;
  readonly lines: {
    /** Lines in the gold answer, lines in the result, and pairs matched between them. */
    readonly gold: number;
    readonly result: number;
    readonly matched: number;
    /** For each field, the matched pairs where it is right. */
    readonly fieldsRight: Readonly<Record<LineField, number>>;
  };
  /**
   * What differs, as paths: "number", "lines.2.quantity" (gold line 2), "lines.4: not found",
   * "result line 3: not in the gold answer". Never values.
   */
  readonly differences: readonly string[];
  /** Every header field and every line matches. */
  readonly correct: boolean;
}

const LINE_RULES: Readonly<
  Record<LineField, (a: string | null, b: string | null) => boolean>
> = {
  supplierCode: sameText,
  description: sameText,
  quantity: sameDecimal,
  unit: sameText,
  unitPrice: sameDecimal,
  discountPercent: sameDecimal,
  vatRate: sameDecimal,
  lineTotal: sameDecimal,
};

/** No totals printed means no VAT breakdown either. */
const vatRows = (document: ExtractedDocument): readonly VatAmount[] =>
  document.totals?.vat ?? [];

const sameVatRow = (a: VatAmount, b: VatAmount) =>
  sameDecimal(a.rate, b.rate) &&
  sameDecimal(a.base, b.base) &&
  sameDecimal(a.amount, b.amount);

/** The same rows in any order: each result row pairs with a different gold row. */
function sameVat(
  result: readonly VatAmount[],
  gold: readonly VatAmount[],
): boolean {
  if (result.length !== gold.length) return false;
  const unused = [...gold];
  return result.every((row) => {
    const i = unused.findIndex((candidate) => sameVatRow(row, candidate));
    if (i === -1) return false;
    unused.splice(i, 1);
    return true;
  });
}

function compareHeader(
  result: ExtractedDocument,
  gold: ExtractedDocument,
): Record<HeaderField, boolean> {
  return {
    documentType: result.documentType === gold.documentType,
    "supplier.name": sameText(result.supplier.name, gold.supplier.name),
    "supplier.taxId": sameText(result.supplier.taxId, gold.supplier.taxId),
    number: sameDocumentNumber(result.number, gold.number),
    issueDate: sameDate(result.issueDate, gold.issueDate),
    "totals.net": sameDecimal(
      result.totals?.net ?? null,
      gold.totals?.net ?? null,
    ),
    "totals.total": sameDecimal(
      result.totals?.total ?? null,
      gold.totals?.total ?? null,
    ),
    "totals.vat": sameVat(vatRows(result), vatRows(gold)),
  };
}

/**
 * Pairs result lines with gold lines, each gold line at most once, going through the lines in
 * printed order: first by supplier code, then by description, then lines that have neither with
 * each other. Returns [result index, gold index] pairs.
 */
export function matchLines(
  result: readonly ExtractedLine[],
  gold: readonly ExtractedLine[],
): [number, number][] {
  const pairs: [number, number][] = [];
  const resultUsed = new Set<number>();
  const goldUsed = new Set<number>();
  const pass = (
    applies: (line: ExtractedLine) => boolean,
    same: (a: ExtractedLine, b: ExtractedLine) => boolean,
  ) => {
    for (const [r, line] of result.entries()) {
      if (resultUsed.has(r) || !applies(line)) continue;
      const g = gold.findIndex(
        (candidate, i) =>
          !goldUsed.has(i) && applies(candidate) && same(line, candidate),
      );
      if (g === -1) continue;
      pairs.push([r, g]);
      resultUsed.add(r);
      goldUsed.add(g);
    }
  };
  pass(
    (line) => line.supplierCode !== null,
    (a, b) => sameText(a.supplierCode, b.supplierCode),
  );
  pass(
    (line) => line.description !== null,
    (a, b) => sameText(a.description, b.description),
  );
  pass(
    (line) => line.supplierCode === null && line.description === null,
    () => true,
  );
  return pairs;
}

export function compareDocument(
  result: ExtractedDocument,
  gold: ExtractedDocument,
): DocumentComparison {
  const header = compareHeader(result, gold);
  const pairs = matchLines(result.lines, gold.lines).sort(
    ([, a], [, b]) => a - b,
  );

  const fieldsRight = Object.fromEntries(
    LINE_FIELDS.map((field) => [field, 0]),
  ) as Record<LineField, number>;
  const lineDifferences: string[] = [];
  for (const [r, g] of pairs) {
    const line = result.lines[r]!;
    const expected = gold.lines[g]!;
    for (const field of LINE_FIELDS) {
      if (LINE_RULES[field](line[field], expected[field])) {
        fieldsRight[field]++;
      } else {
        lineDifferences.push(`lines.${g}.${field}`);
      }
    }
  }
  const matchedGold = new Set(pairs.map(([, g]) => g));
  const matchedResult = new Set(pairs.map(([r]) => r));

  const differences = [
    ...HEADER_FIELDS.filter((field) => !header[field]),
    ...lineDifferences,
    ...gold.lines.flatMap((_line, g) =>
      matchedGold.has(g) ? [] : [`lines.${g}: not found`],
    ),
    ...result.lines.flatMap((_line, r) =>
      matchedResult.has(r) ? [] : [`result line ${r}: not in the gold answer`],
    ),
  ];

  return {
    header,
    lines: {
      gold: gold.lines.length,
      result: result.lines.length,
      matched: pairs.length,
      fieldsRight,
    },
    differences,
    correct: differences.length === 0,
  };
}
