import { toBaseUnits, type UnitConversion } from "./conversion";
import type { DeliveryNote, DocumentLine, Invoice } from "./document";
import type { Quantity } from "./quantity";

/** A suggestion that an invoice line bills a delivery-note line. */
export interface BilledLine {
  readonly invoiceLineId: string;
  readonly deliveryNoteLineId: string;
}

/**
 * Suggests which delivery-note line each invoice line bills (decision 0032), for a person to
 * confirm. The candidates are the lines of the supplier's posted delivery notes, reversals left
 * out, with the same product and the same quantity in base units. A pair is suggested only when
 * each is the other's only candidate; anything ambiguous is left for a person.
 *
 * Invoice lines that already bill a line, and the lines they bill, are kept out. A line whose
 * unit can't be converted is skipped. Pass the delivery notes the invoice lists, if it lists
 * them, and only lines no other invoice bills: the ledger doesn't know which those are.
 * Suggestions come in the invoice's line order.
 */
export function suggestBilledLines(
  invoice: Invoice,
  deliveryNotes: readonly DeliveryNote[],
  conversions: readonly UnitConversion[],
): BilledLine[] {
  const taken = new Set(
    invoice.lines.flatMap((l) =>
      l.deliveryNoteLineId === undefined ? [] : [l.deliveryNoteLineId],
    ),
  );
  const keyOf = (line: DocumentLine): string | undefined => {
    let quantity: Quantity;
    try {
      quantity = toBaseUnits(line, conversions);
    } catch {
      return undefined;
    }
    return JSON.stringify([line.productId, quantity]);
  };

  const noteLines = deliveryNotes
    .filter(
      (n) =>
        n.supplierId === invoice.supplierId &&
        n.status === "posted" &&
        n.reverses === undefined,
    )
    .flatMap((n) => n.lines)
    .filter((l) => !taken.has(l.id));
  const invoiceLines = invoice.lines.filter(
    (l) => l.deliveryNoteLineId === undefined,
  );

  // Every line by its product and base quantity, on each side.
  const group = <L extends DocumentLine>(lines: readonly L[]) => {
    const groups = new Map<string, L[]>();
    for (const line of lines) {
      const key = keyOf(line);
      if (key === undefined) continue;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    return groups;
  };
  const onNotes = group(noteLines);
  const onInvoice = group(invoiceLines);

  return invoiceLines.flatMap((line) => {
    const key = keyOf(line);
    if (key === undefined) return [];
    const candidates = onNotes.get(key) ?? [];
    const rivals = onInvoice.get(key) ?? [];
    const [only] = candidates;
    if (only === undefined || candidates.length > 1 || rivals.length > 1) {
      return [];
    }
    return [{ invoiceLineId: line.id, deliveryNoteLineId: only.id }];
  });
}
