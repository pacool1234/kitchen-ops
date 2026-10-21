import { normalizedNumber } from "@kitchen-ops/extract";
import * as ledger from "@kitchen-ops/ledger";
import type {
  BillableLine,
  ExtractedDocument,
  LineBilling,
  LineMatch,
} from "@kitchen-ops/shared";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  notExists,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "../audit/audited";
import { readSupplierProduct } from "../catalogue/supplier-products";
import type { Db } from "../db/client";
import {
  documentLines,
  documents,
  invoiceLineBills,
  products,
} from "../db/schema";
import { movementsOf } from "../posting/stored";

// Which delivery-note line each line of an invoice bills (#120, decisions 0032 and 0041),
// worked out each time, like the rest of a document's matching:
// - the lines it may bill: its supplier's posted delivery notes that stand, and their lines no
//   standing invoice bills (a credit note may bill one again: it restates its price);
// - a suggestion, where an invoice line and a delivery-note line are each other's only candidate
//   among the delivery notes it lists, or else those of the 62 days up to its date;
// - a choice office or the owner confirmed (invoice_line_bills), or received with the invoice,
//   as every line of an invoice-only supplier's is until someone says otherwise;
// - for a billed line, its price now, the invoice's, and the difference in euros.

type Reader = Db | Tx;

/** How far back, before an invoice's date, its delivery notes are looked for. */
export const BILLING_WINDOW_DAYS = 62;

/** A credit note (factura rectificativa): an invoice whose total is negative. */
export function isCreditNote(draft: ExtractedDocument): boolean {
  return (
    draft.documentType === "invoice" &&
    (draft.totals?.total?.startsWith("-") ?? false)
  );
}

/** A delivery-note line an invoice may bill, with what posting needs of it. */
export interface Billable {
  readonly line: BillableLine;
  /** The supplier product it was received at (decision 0038), if any. */
  readonly supplierProductId: string | null;
  /** Its price now: the unit cost of the receipt that stands for its goods. */
  readonly unitCost: ledger.UnitCost;
}

const delivery = alias(documents, "delivery");
const deliveryReversal = alias(documents, "delivery_reversal");
const billingLine = alias(documentLines, "billing_line");
const billing = alias(documents, "billing");
const billingReversal = alias(documents, "billing_reversal");

/** The posted delivery notes of a supplier that stand: not reversals, and not reversed. */
const standingDelivery = (db: Reader, supplierId: string) =>
  and(
    eq(delivery.supplierId, supplierId),
    eq(delivery.type, "delivery-note"),
    eq(delivery.status, "posted"),
    isNull(delivery.reverses),
    notExists(
      db
        .select({ id: deliveryReversal.id })
        .from(deliveryReversal)
        .where(eq(deliveryReversal.reverses, delivery.id)),
    ),
  );

/** Whether the supplier has ever posted a delivery note that stands. */
async function sendsDeliveryNotes(db: Reader, supplierId: string) {
  const [found] = await db
    .select({ id: delivery.id })
    .from(delivery)
    .where(standingDelivery(db, supplierId))
    .limit(1);
  return found !== undefined;
}

/**
 * The supplier's delivery-note lines an invoice may bill, newest delivery note first: the
 * lines of its posted delivery notes that stand, with goods still received, and, unless it's
 * for a credit note, that no standing invoice bills.
 */
export async function billableLines(
  db: Reader,
  supplierId: string,
  { credit }: { credit: boolean },
): Promise<Billable[]> {
  const rows = await db
    .select({
      id: documentLines.id,
      deliveryNoteId: delivery.id,
      number: delivery.number,
      date: delivery.date,
      position: documentLines.position,
      productId: products.id,
      productName: products.name,
      baseUnit: products.baseUnit,
      quantity: documentLines.quantity,
      unit: documentLines.unit,
      supplierProductId: documentLines.supplierProductId,
    })
    .from(documentLines)
    .innerJoin(delivery, eq(delivery.id, documentLines.documentId))
    .innerJoin(products, eq(products.id, documentLines.productId))
    .where(
      and(
        standingDelivery(db, supplierId),
        credit ? undefined : notExists(billedByStanding(db)),
      ),
    )
    .orderBy(
      desc(delivery.date),
      desc(delivery.id),
      asc(documentLines.position),
    );
  const movements = await movementsOf(db, [
    ...new Set(rows.map((r) => r.productId)),
  ]);
  return rows.flatMap((row): Billable[] => {
    const receipt = ledger.standingReceipt(movements, row.id);
    if (receipt === undefined) return [];
    return [
      {
        line: {
          id: row.id,
          deliveryNote: {
            id: row.deliveryNoteId,
            number: row.number,
            date: row.date!,
          },
          position: row.position,
          product: {
            id: row.productId,
            name: row.productName,
            baseUnit: row.baseUnit,
          },
          quantity: canonical(row.quantity),
          unit: row.unit,
          baseQuantity: receipt.quantity,
          unitCost: ledger.formatUnitCost(receipt.unitCost),
        },
        supplierProductId: row.supplierProductId,
        unitCost: receipt.unitCost,
      },
    ];
  });
}

/** A standing invoice (not a reversal, not reversed) bills the delivery-note line. */
function billedByStanding(db: Reader) {
  return db
    .select({ id: billingLine.id })
    .from(billingLine)
    .innerJoin(billing, eq(billing.id, billingLine.documentId))
    .where(
      and(
        eq(billingLine.billsLineId, documentLines.id),
        isNull(billing.reverses),
        notExists(
          db
            .select({ id: billingReversal.id })
            .from(billingReversal)
            .where(eq(billingReversal.reverses, billing.id)),
        ),
      ),
    );
}

/** Of these delivery-note lines, the ones a standing invoice bills. */
export async function billedAlready(
  db: Reader,
  lineIds: readonly string[],
): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const rows = await db
    .select({ id: documentLines.id })
    .from(documentLines)
    .where(
      and(
        inArray(documentLines.id, [...lineIds]),
        exists(billedByStanding(db)),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** "5.000000" as "5", "1.500000" as "1.5": a stored decimal as it was printed. */
function canonical(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** A stored choice: a delivery-note line, or received with the invoice. */
export interface StoredChoice {
  readonly id: string;
  readonly position: number;
  readonly deliveryNoteLineId: string | null;
  readonly received: boolean;
}

export async function storedChoices(
  db: Reader,
  documentId: string,
): Promise<StoredChoice[]> {
  return db
    .select({
      id: invoiceLineBills.id,
      position: invoiceLineBills.position,
      deliveryNoteLineId: invoiceLineBills.deliveryNoteLineId,
      received: invoiceLineBills.received,
    })
    .from(invoiceLineBills)
    .where(eq(invoiceLineBills.documentId, documentId))
    .orderBy(asc(invoiceLineBills.position));
}

/** How posting takes a line: billing a delivery-note line, or received like a delivery note's. */
export type LinePlan =
  | {
      readonly kind: "billed";
      readonly deliveryNoteLineId: string;
      readonly productId: string;
      /** The pack the invoice's quantity is converted with; null if there's none. */
      readonly pack: { id: string; baseUnits: number } | null;
      /** Per printed unit: the invoice's, or a credit note's difference on top of the price now. */
      readonly unitPrice: ledger.UnitCost | null;
      /** A credit note's difference, restated as the line's new price. */
      readonly restated: boolean;
    }
  | { readonly kind: "received" }
  | { readonly kind: "undecided" };

export interface InvoiceBilling {
  /** One per line: what the matching answer says it bills. */
  readonly lines: readonly (LineBilling | null)[];
  /** One per line: what posting does with it, once it's confirmed. */
  readonly plans: readonly LinePlan[];
  /** The billed lines' differences added up, in euros. */
  readonly difference: ledger.Money;
}

/** A quantity in base units at `baseUnits` a printed unit, or null if it isn't whole. */
function inBaseUnits(quantity: string, baseUnits: number): number | null {
  try {
    return ledger.toBaseUnits({ productId: "", quantity, unit: "pack" }, [
      { productId: "", unit: "pack", factor: baseUnits },
    ]);
  } catch {
    return null;
  }
}

const sameUnit = (a: string | null, b: string) =>
  a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/** A date `days` before an ISO date, as YYYY-MM-DD. */
function daysBefore(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) - days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Which delivery-note line each invoice line bills: confirmed, suggested, received or neither;
 * how posting takes each; and the difference. `matches` are the lines' own supplier products,
 * by code or description, one per line.
 */
export async function invoiceBilling(
  db: Reader,
  {
    documentId,
    draft,
    supplierId,
    matches,
  }: {
    documentId: string;
    draft: ExtractedDocument;
    supplierId: string | null;
    matches: readonly (LineMatch | null)[];
  },
): Promise<InvoiceBilling> {
  const nothing = ledger.moneyFromCents(0n);
  if (supplierId === null) {
    return {
      lines: draft.lines.map(() => null),
      plans: draft.lines.map(() => ({ kind: "undecided" })),
      difference: nothing,
    };
  }
  const credit = isCreditNote(draft);
  const [stored, billable, delivers] = await Promise.all([
    storedChoices(db, documentId),
    billableLines(db, supplierId, { credit }),
    sendsDeliveryNotes(db, supplierId),
  ]);
  const byId = new Map(billable.map((b) => [b.line.id, b]));
  const choiceAt = new Map(stored.map((c) => [c.position, c]));
  const own = (i: number) => {
    const match = matches[i];
    return match && match.by !== "suggestion" ? match.supplierProduct : null;
  };

  const suggested = delivers
    ? suggestions(draft, billable, stored, choiceAt, own)
    : new Map<number, string>();

  const lines: (LineBilling | null)[] = [];
  const plans: LinePlan[] = [];
  let difference = nothing;
  for (const [i, line] of draft.lines.entries()) {
    const choice = choiceAt.get(i + 1);
    if (choice?.received || (choice === undefined && !delivers)) {
      lines.push({ by: "received" });
      plans.push({ kind: "received" });
      continue;
    }
    const chosen = choice?.deliveryNoteLineId ?? suggested.get(i);
    const target = chosen === undefined ? undefined : byId.get(chosen);
    if (target === undefined) {
      lines.push(null);
      plans.push({ kind: "undecided" });
      continue;
    }

    // The invoice's quantity, at its own supplier product's pack, or else at the delivery-note
    // line's when it's printed in the same unit.
    const mine = own(i);
    const theirs =
      mine === null &&
      target.supplierProductId !== null &&
      sameUnit(line.unit, target.line.unit)
        ? await readSupplierProduct(db, target.supplierProductId)
        : undefined;
    const pack = mine
      ? { id: mine.id, baseUnits: mine.packBaseUnits }
      : theirs
        ? { id: theirs.id, baseUnits: theirs.packBaseUnits }
        : null;
    const base =
      pack && line.quantity !== null
        ? inBaseUnits(line.quantity, pack.baseUnits)
        : null;
    const quantityMatches = base === target.line.baseQuantity;

    // A credit note's negative price on goods received is a difference on the price now.
    const printed =
      line.unitPrice === null ? null : ledger.parseUnitCost(line.unitPrice);
    const restates =
      credit &&
      printed !== null &&
      printed < 0n &&
      !(line.quantity ?? "").startsWith("-");
    const unitPrice =
      restates && pack
        ? ledger.unitCostFromMillionths(
            target.unitCost * BigInt(pack.baseUnits) + printed,
          )
        : restates
          ? null
          : printed;

    let total: ledger.Money | null = null;
    if (unitPrice !== null && line.quantity !== null) {
      try {
        total = ledger.lineTotal({
          quantity: line.quantity,
          unitPrice,
          ...(line.discountPercent === null
            ? {}
            : { discountPercent: line.discountPercent }),
        });
      } catch {
        total = null;
      }
    }
    let invoiceUnitCost: string | null = null;
    let lineDifference: ledger.Money | null = null;
    if (quantityMatches && total !== null) {
      try {
        invoiceUnitCost = ledger.formatUnitCost(
          ledger.receivedUnitCost(total, base!),
        );
        lineDifference = ledger.subtractMoney(
          total,
          ledger.lineTotal({
            quantity: String(target.line.baseQuantity),
            unitPrice: target.unitCost,
          }),
        );
      } catch {
        invoiceUnitCost = null;
        lineDifference = null;
      }
    }
    if (lineDifference !== null) {
      difference = ledger.addMoney(difference, lineDifference);
    }
    lines.push({
      by: choice?.deliveryNoteLineId ? "confirmed" : "suggested",
      deliveryNoteLine: target.line,
      invoiceUnitCost,
      difference:
        lineDifference === null ? null : ledger.formatMoney(lineDifference),
      quantityMatches,
    });
    plans.push(
      choice?.deliveryNoteLineId
        ? {
            kind: "billed",
            deliveryNoteLineId: target.line.id,
            productId: target.line.product.id,
            pack,
            unitPrice,
            restated: restates,
          }
        : { kind: "undecided" },
    );
  }
  return { lines, plans, difference };
}

/**
 * Suggestions, by line index: the delivery-note line each undecided line bills, where they're
 * each other's only candidate (`ledger.suggestBilledLines`). Among the delivery notes the
 * invoice lists, if it lists any of them; or else those of the window up to its date. Lines
 * confirmed already are left out on both sides, and so is a return.
 */
function suggestions(
  draft: ExtractedDocument,
  billable: readonly Billable[],
  stored: readonly StoredChoice[],
  choiceAt: ReadonlyMap<number, StoredChoice>,
  own: (
    i: number,
  ) => { id: string; product: { id: string }; packBaseUnits: number } | null,
): Map<number, string> {
  const listed = new Set(draft.deliveryNotes.map(normalizedNumber));
  const isListed = (b: Billable) =>
    b.line.deliveryNote.number !== null &&
    listed.has(normalizedNumber(b.line.deliveryNote.number));
  const date = draft.issueDate;
  const inWindow = (b: Billable) =>
    date === null ||
    (b.line.deliveryNote.date <= date &&
      b.line.deliveryNote.date >= daysBefore(date, BILLING_WINDOW_DAYS));
  const taken = new Set(stored.flatMap((c) => c.deliveryNoteLineId ?? []));
  const pool = (
    billable.some(isListed)
      ? billable.filter(isListed)
      : billable.filter(inWindow)
  ).filter((b) => !taken.has(b.line.id));

  const conversions: ledger.UnitConversion[] = [];
  const invoiceLines: ledger.InvoiceLine[] = [];
  for (const [i, line] of draft.lines.entries()) {
    const mine = own(i);
    if (
      choiceAt.has(i + 1) ||
      mine === null ||
      line.quantity === null ||
      line.quantity.startsWith("-")
    ) {
      continue;
    }
    const unit = `pack:${mine.id}`;
    conversions.push({
      productId: mine.product.id,
      unit,
      factor: mine.packBaseUnits,
    });
    invoiceLines.push({
      id: String(i),
      productId: mine.product.id,
      quantity: line.quantity,
      unit,
      unitPrice: ledger.unitCostFromMillionths(0n),
    });
  }
  if (invoiceLines.length === 0 || pool.length === 0) return new Map();

  // Delivery-note lines in base units, at a unit of their own.
  for (const productId of new Set(pool.map((b) => b.line.product.id))) {
    conversions.push({ productId, unit: "base", factor: 1 });
  }
  const notes = new Map<string, ledger.DeliveryNote>();
  for (const b of pool) {
    const id = b.line.deliveryNote.id;
    const note = notes.get(id) ?? {
      id,
      date: b.line.deliveryNote.date,
      status: "posted" as const,
      storeroomId: "",
      type: "delivery-note" as const,
      supplierId: "supplier",
      lines: [],
    };
    notes.set(id, {
      ...note,
      lines: [
        ...note.lines,
        {
          id: b.line.id,
          productId: b.line.product.id,
          quantity: String(b.line.baseQuantity),
          unit: "base",
          unitPrice: b.unitCost,
        },
      ],
    });
  }
  const invoice: ledger.Invoice = {
    id: "invoice",
    date: date ?? "",
    status: "review",
    storeroomId: "",
    type: "invoice",
    supplierId: "supplier",
    lines: invoiceLines,
  };
  return new Map(
    ledger
      .suggestBilledLines(invoice, [...notes.values()], conversions)
      .map((s) => [Number(s.invoiceLineId), s.deliveryNoteLineId]),
  );
}
