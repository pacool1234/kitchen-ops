import type {
  DocumentType,
  ExtractedDocument,
  ExtractedLine,
  Role,
} from "@kitchen-ops/shared";

// The review form (#118): a document's draft as its fields hold it, text, "" for nothing; and
// back to the draft the API takes, so a draft nobody touched goes back exactly as it came.
// Decimals stay strings all the way (CLAUDE.md): UiNumberField gives them as "2.5".

export type LineValues = { [K in keyof ExtractedLine]: string };

export interface VatValues {
  rate: string;
  base: string;
  amount: string;
}

export interface DraftValues {
  documentType: DocumentType;
  supplier: { name: string; taxId: string };
  number: string;
  /** As typed, dd/mm/aaaa. */
  issueDate: string;
  /** Whether it shows prices. Off, the totals are null, and kept for when it's on again. */
  hasTotals: boolean;
  totals: { net: string; vat: VatValues[]; total: string };
  lines: LineValues[];
}

export const emptyLine = (): LineValues => ({
  supplierCode: "",
  description: "",
  quantity: "",
  unit: "",
  unitPrice: "",
  discountPercent: "",
  vatRate: "",
  lineTotal: "",
});

export const emptyVatRow = (): VatValues => ({
  rate: "",
  base: "",
  amount: "",
});

const shown = (value: string | null) => value ?? "";

/**
 * Text as typed: nothing is null (not printed); anything else exactly as it is, spaces too, so
 * a field nobody touched goes back as it was read (a counter user's save must change only
 * quantities).
 */
const typed = (value: string) => (value === "" ? null : value);

/** A date to type over: "2026-10-20" is "20/10/2026". */
export function writeDate(date: string | null): string {
  if (date === null) return "";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * A date as typed, the Spanish way: day, month and a 4-digit year, with /, - or . between them;
 * "" is no date. A day that doesn't exist, or any other order, is refused: 10/20/2026 isn't
 * guessed to be American.
 */
export function readDate(
  text: string,
): { ok: true; value: string | null } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed);
  if (!match) return { ok: false };
  const [day, month, year] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false };
  }
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return { ok: true, value: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` };
}

/** The form's values for a draft; for nothing read, a delivery note with one line to fill in. */
export function toValues(draft: ExtractedDocument | null): DraftValues {
  if (draft === null) {
    return {
      documentType: "delivery-note",
      supplier: { name: "", taxId: "" },
      number: "",
      issueDate: "",
      hasTotals: false,
      totals: { net: "", vat: [], total: "" },
      lines: [emptyLine()],
    };
  }
  return {
    documentType: draft.documentType,
    supplier: {
      name: shown(draft.supplier.name),
      taxId: shown(draft.supplier.taxId),
    },
    number: shown(draft.number),
    issueDate: writeDate(draft.issueDate),
    hasTotals: draft.totals !== null,
    totals: {
      net: shown(draft.totals?.net ?? null),
      vat: (draft.totals?.vat ?? []).map((row) => ({
        rate: shown(row.rate),
        base: shown(row.base),
        amount: shown(row.amount),
      })),
      total: shown(draft.totals?.total ?? null),
    },
    lines: draft.lines.map((line) => ({
      supplierCode: shown(line.supplierCode),
      description: shown(line.description),
      quantity: shown(line.quantity),
      unit: shown(line.unit),
      unitPrice: shown(line.unitPrice),
      discountPercent: shown(line.discountPercent),
      vatRate: shown(line.vatRate),
      lineTotal: shown(line.lineTotal),
    })),
  };
}

/**
 * The draft the form's values make, to check with ExtractedDocument and send. A date that can't
 * be read goes as typed, so the schema refuses it on its own field; a tax ID goes as the schema
 * takes it, in capitals without spaces, dots or hyphens.
 */
export function toDraft(values: DraftValues): ExtractedDocument {
  const date = readDate(values.issueDate);
  const taxId = typed(values.supplier.taxId);
  return {
    documentType: values.documentType,
    currency: "EUR",
    supplier: {
      name: typed(values.supplier.name),
      taxId: taxId && taxId.toUpperCase().replace(/[\s./-]/g, ""),
    },
    number: typed(values.number),
    issueDate: date.ok ? date.value : values.issueDate,
    totals: values.hasTotals
      ? {
          net: typed(values.totals.net),
          vat: values.totals.vat.map((row) => ({
            rate: typed(row.rate),
            base: typed(row.base),
            amount: typed(row.amount),
          })),
          total: typed(values.totals.total),
        }
      : null,
    lines: values.lines.map((line) => ({
      supplierCode: typed(line.supplierCode),
      description: typed(line.description),
      quantity: typed(line.quantity),
      unit: typed(line.unit),
      unitPrice: typed(line.unitPrice),
      discountPercent: typed(line.discountPercent),
      vatRate: typed(line.vatRate),
      lineTotal: typed(line.lineTotal),
    })),
  };
}

/** Each line field, in the order the form shows them. */
export const LINE_FIELDS = [
  "supplierCode",
  "description",
  "quantity",
  "unit",
  "unitPrice",
  "discountPercent",
  "vatRate",
  "lineTotal",
] as const satisfies readonly (keyof ExtractedLine)[];

/**
 * Where a check's failure or a field's error can show on the form: every field, by its path in
 * the draft ("lines.0.lineTotal"), and the blocks a check names as a whole ("totals",
 * "totals.vat").
 */
export function reviewPaths(values: DraftValues): string[] {
  return [
    "documentType",
    "supplier.name",
    "supplier.taxId",
    "number",
    "issueDate",
    "totals",
    "totals.net",
    "totals.vat",
    ...values.totals.vat.flatMap((_, i) =>
      ["rate", "base", "amount"].map((field) => `totals.vat.${i}.${field}`),
    ),
    "totals.total",
    ...values.lines.flatMap((_, i) =>
      LINE_FIELDS.map((field) => `lines.${i}.${field}`),
    ),
  ];
}

/**
 * What a role may change of a draft in review (spec section 6, decision 0037): office and owner,
 * everything; a counter user, a delivery note's quantities; nothing else. The API decides the
 * same; this only keeps the screen from offering what it would refuse.
 */
export function editing(
  role: Role,
  draft: ExtractedDocument | null,
): "all" | "quantities" | "none" {
  if (role !== "counter") return "all";
  return draft?.documentType === "delivery-note" ? "quantities" : "none";
}
