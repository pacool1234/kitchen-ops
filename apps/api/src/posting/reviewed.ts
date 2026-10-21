import * as ledger from "@kitchen-ops/ledger";
import type { ExtractedDocument, FieldErrorCode } from "@kitchen-ops/shared";

// A document as reviewed, ready to post (#116), and how a reviewed delivery note's draft becomes
// one (#119, decision 0038): each line at the pack of the supplier product it matched, into the
// storeroom chosen for it or its product's default, and at 0 when it shows no price, until an
// invoice corrects it (decision 0032). Pure: the endpoint reads what it needs and passes it in.

/** One line as reviewed: what the ledger posts, without the ID it's given when it's stored. */
export interface ReviewedLine {
  readonly productId: string;
  /** In `unit`, as printed: "1.5" boxes. */
  readonly quantity: string;
  readonly unit: string;
  /** Per purchase unit, before discount, excluding VAT. */
  readonly unitPrice: ledger.UnitCost;
  readonly discountPercent?: string;
  readonly vatRate?: string;
  /** Where it's received, if not the document's storeroom (decision 0033). */
  readonly storeroomId?: string;
  /** For an invoice line: the posted delivery-note line it bills (decision 0032). */
  readonly billsLineId?: string;
  /** A flagged adjustment: it may take stock below zero (invariant 6). */
  readonly adjustment?: true;
  /**
   * The supplier product the line matched (decision 0038): one of its `unit`, as printed, holds
   * that supplier product's pack, `baseUnitsPerUnit` base units. The line is converted with this
   * alone, not with the product's own conversions, so its price is never divided.
   */
  readonly supplierProduct?: {
    readonly id: string;
    readonly baseUnitsPerUnit: number;
  };
}

/** A document as reviewed, ready to post: its header as corrected, and its lines. */
export interface ReviewedDocument {
  readonly type: "delivery-note" | "invoice";
  readonly supplierId: string;
  readonly number: string | null;
  /** The issue date, YYYY-MM-DD. */
  readonly date: string;
  /** Where its lines are received unless they name their own. */
  readonly storeroomId: string;
  readonly lines: readonly ReviewedLine[];
}

/**
 * The unit the ledger converts a supplier product's line with: one of its own, so two packs of
 * the same product, or a pack and the product's conversion of the same name, never clash.
 */
const packUnit = (supplierProductId: string) => `pack:${supplierProductId}`;

/**
 * The lines as the ledger takes them, each under its ID, and the conversions of the packs they
 * were received at. A line without a supplier product keeps its unit, for the product's own.
 */
export function ledgerLines(
  reviewed: ReviewedDocument,
  lineIds: readonly string[],
): { lines: ledger.InvoiceLine[]; conversions: ledger.UnitConversion[] } {
  const conversions = new Map<string, ledger.UnitConversion>();
  const lines = reviewed.lines.map((line, i): ledger.InvoiceLine => {
    const pack = line.supplierProduct;
    if (pack) {
      const unit = packUnit(pack.id);
      conversions.set(unit, {
        productId: line.productId,
        unit,
        factor: pack.baseUnitsPerUnit,
      });
    }
    return {
      id: lineIds[i]!,
      productId: line.productId,
      quantity: line.quantity,
      unit: pack ? packUnit(pack.id) : line.unit,
      unitPrice: line.unitPrice,
      ...(line.discountPercent === undefined
        ? {}
        : { discountPercent: line.discountPercent }),
      ...(line.vatRate === undefined ? {} : { vatRate: line.vatRate }),
      ...(line.storeroomId === undefined
        ? {}
        : { storeroomId: line.storeroomId }),
      ...(line.billsLineId === undefined
        ? {}
        : { deliveryNoteLineId: line.billsLineId }),
      ...(line.adjustment === true ? { adjustment: true as const } : {}),
    };
  });
  return { lines, conversions: [...conversions.values()] };
}

/** A draft line's match: the supplier product, its pack, and its product's storeroom. */
export interface MatchedLine {
  readonly supplierProductId: string;
  readonly productId: string;
  /** The pack in the product's base units, from its current conversions. */
  readonly packBaseUnits: number;
  /** The product's default storeroom, if it has one. */
  readonly defaultStoreroomId: string | null;
}

/** A draft line received at its match's pack, or why it can't be, on `fields` (decision 0038). */
function receivedLine(
  line: ExtractedDocument["lines"][number],
  i: number,
  match: MatchedLine,
  chosen: string | null,
  fields: Record<string, FieldErrorCode>,
): ReviewedLine | null {
  const storeroomId = chosen ?? match.defaultStoreroomId;
  if (storeroomId === null) fields[`lines.${i}.storeroomId`] = "required";
  if (line.quantity === null) fields[`lines.${i}.quantity`] = "required";
  if (line.unit === null) fields[`lines.${i}.unit`] = "required";
  if (storeroomId === null || line.quantity === null || line.unit === null) {
    return null;
  }
  try {
    ledger.toBaseUnits(
      { productId: match.productId, quantity: line.quantity, unit: line.unit },
      [
        {
          productId: match.productId,
          unit: line.unit,
          factor: match.packBaseUnits,
        },
      ],
    );
  } catch {
    fields[`lines.${i}.quantity`] = "not_whole_base_units";
    return null;
  }
  return {
    productId: match.productId,
    quantity: line.quantity,
    unit: line.unit,
    // No price printed: received at 0 until an invoice corrects it (decision 0032).
    unitPrice: ledger.parseUnitCost(line.unitPrice ?? "0"),
    ...(line.discountPercent === null
      ? {}
      : { discountPercent: line.discountPercent }),
    ...(line.vatRate === null ? {} : { vatRate: line.vatRate }),
    storeroomId,
    supplierProduct: {
      id: match.supplierProductId,
      baseUnitsPerUnit: match.packBaseUnits,
    },
  };
}

type ToPost =
  | { ok: true; document: ReviewedDocument }
  | { ok: false; fields: Record<string, FieldErrorCode> };

/**
 * A reviewed delivery note's draft, as it stands, as posting takes it; or why a line can't be
 * posted, by its field in the draft ("lines.1.storeroomId"). `matched` and `storerooms` have one
 * entry per line, in order; a storeroom is null for the product's default.
 */
export function deliveryNoteToPost({
  draft,
  supplierId,
  matched,
  storerooms,
}: {
  draft: ExtractedDocument;
  supplierId: string;
  matched: readonly MatchedLine[];
  storerooms: readonly (string | null)[];
}): ToPost {
  const fields: Record<string, FieldErrorCode> = {};
  const lines = draft.lines.flatMap((line, i) => {
    const received = receivedLine(
      line,
      i,
      matched[i]!,
      storerooms[i] ?? null,
      fields,
    );
    return received === null ? [] : [received];
  });
  if (draft.issueDate === null) fields.issueDate = "required";
  if (Object.keys(fields).length > 0 || draft.issueDate === null) {
    return { ok: false, fields };
  }
  return {
    ok: true,
    document: {
      type: "delivery-note",
      supplierId,
      number: draft.number,
      date: draft.issueDate,
      // Every line names its own; the document's is the first one's.
      storeroomId: lines[0]!.storeroomId!,
      lines,
    },
  };
}

/** How an invoice's line is posted, once it's confirmed (#120, decision 0041). */
export type InvoiceLinePlan =
  | {
      readonly kind: "billed";
      readonly deliveryNoteLineId: string;
      /** The delivery-note line's product: what it received. */
      readonly productId: string;
      /** The pack the invoice's quantity is converted with, if there's one. */
      readonly pack: { readonly id: string; readonly baseUnits: number } | null;
      /** Per printed unit; for a credit note's difference, on top of the line's price now. */
      readonly unitPrice: ledger.UnitCost | null;
      /** A credit note's difference, restated as the line's new price. */
      readonly restated: boolean;
    }
  | { readonly kind: "received"; readonly matched: MatchedLine }
  | { readonly kind: "undecided" };

/**
 * A reviewed invoice's draft, as it stands, as posting takes it (decision 0032): a line it bills
 * corrects that delivery-note line's price, at the delivery note's product, and goes to no
 * storeroom; a line received with it is received like a delivery note's. Or why a line can't be
 * posted, by its field. `plans` and `storerooms` have one entry per line.
 */
export function invoiceToPost({
  draft,
  supplierId,
  plans,
  storerooms,
}: {
  draft: ExtractedDocument;
  supplierId: string;
  plans: readonly InvoiceLinePlan[];
  storerooms: readonly (string | null)[];
}): ToPost {
  const fields: Record<string, FieldErrorCode> = {};
  const lines = draft.lines.flatMap((line, i): ReviewedLine[] => {
    const plan = plans[i]!;
    if (plan.kind === "undecided") {
      // Posting is refused while a line is undecided: it never gets here.
      throw new Error(`line ${i + 1} is undecided`);
    }
    if (plan.kind === "received") {
      const received = receivedLine(
        line,
        i,
        plan.matched,
        storerooms[i] ?? null,
        fields,
      );
      return received === null ? [] : [received];
    }
    if (line.quantity === null) fields[`lines.${i}.quantity`] = "required";
    if (line.unit === null) fields[`lines.${i}.unit`] = "required";
    if (plan.unitPrice === null) fields[`lines.${i}.unitPrice`] = "required";
    if (plan.pack === null) fields[`lines.${i}.quantity`] = "invalid";
    // A difference has no discount to take: the price it restates has its own.
    if (plan.restated && line.discountPercent !== null) {
      fields[`lines.${i}.discountPercent`] = "invalid";
    }
    if (
      line.quantity === null ||
      line.unit === null ||
      plan.unitPrice === null ||
      plan.pack === null ||
      (plan.restated && line.discountPercent !== null)
    ) {
      return [];
    }
    return [
      {
        productId: plan.productId,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: plan.unitPrice,
        ...(line.discountPercent === null
          ? {}
          : { discountPercent: line.discountPercent }),
        ...(line.vatRate === null ? {} : { vatRate: line.vatRate }),
        billsLineId: plan.deliveryNoteLineId,
        supplierProduct: {
          id: plan.pack.id,
          baseUnitsPerUnit: plan.pack.baseUnits,
        },
      },
    ];
  });
  if (draft.issueDate === null) fields.issueDate = "required";
  if (Object.keys(fields).length > 0 || draft.issueDate === null) {
    return { ok: false, fields };
  }
  return {
    ok: true,
    document: {
      type: "invoice",
      supplierId,
      number: draft.number,
      date: draft.issueDate,
      // A line it bills stays where its delivery note received it; the document's storeroom is
      // only for lines received with it, which name their own.
      storeroomId: lines.find((l) => l.storeroomId)?.storeroomId ?? "",
      lines,
    },
  };
}
