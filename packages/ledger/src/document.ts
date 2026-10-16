import { toBaseUnits, type UnitConversion } from "./conversion";
import { averageCost, receivedUnitCost } from "./cost";
import { lineTotal, type UnitCost } from "./money";
import {
  appendMovements,
  reverseMovement,
  stockOnHand,
  type Movement,
  type MovementKind,
} from "./movement";
import { addQuantities, type Quantity } from "./quantity";

/** Draft and review are editable; posted is final (invariant 7). */
export type DocumentStatus = "draft" | "review" | "posted";

/** One line of a document (spec section 3). */
export interface DocumentLine {
  /** Passed in, never generated here. Movements point to it (invariant 2). */
  readonly id: string;
  readonly productId: string;
  /** In `unit`, as printed: "1.5" boxes. Converted with the product's unit conversions. */
  readonly quantity: string;
  readonly unit: string;
  /**
   * A flagged adjustment (invariant 6): the movement this line takes out of stock may leave it
   * below zero. Without the flag, such a line fails.
   */
  readonly adjustment?: true;
}

/** A delivery-note line also has a price. */
export interface DeliveryNoteLine extends DocumentLine {
  /** Per purchase unit (per box, per kg), before discount, excluding VAT. */
  readonly unitPrice: UnitCost;
  /** The "Dto." column as a percentage: "5" is 5%. */
  readonly discountPercent?: string;
  /** Kept with the line, but unused: costs exclude VAT (spec section 4). */
  readonly vatRate?: string;
}

interface DocumentHeader {
  /** Passed in, never generated here. */
  readonly id: string;
  /** An ISO date ("2026-10-16"), kept as text. The ledger never reads it. */
  readonly date: string;
  /** The number printed on the document, if it has one. */
  readonly number?: string;
  readonly status: DocumentStatus;
  /** Where the stock is: received into, wasted from, counted in, or transferred from. */
  readonly storeroomId: string;
  /** The posted document this one reverses, if it is a reversal. */
  readonly reverses?: string;
}

/** Goods from a supplier: adds stock at the received unit cost. */
export interface DeliveryNote extends DocumentHeader {
  readonly type: "delivery-note";
  readonly supplierId: string;
  readonly lines: readonly DeliveryNoteLine[];
}

/** Stock thrown away: removes it at the average cost. */
export interface WasteDocument extends DocumentHeader {
  readonly type: "waste";
  readonly lines: readonly DocumentLine[];
}

/** A physical count: each line is the quantity counted in the storeroom. */
export interface CountDocument extends DocumentHeader {
  readonly type: "count";
  readonly lines: readonly DocumentLine[];
}

/** Stock moved from `storeroomId` to `toStoreroomId`, carrying its average cost. */
export interface TransferDocument extends DocumentHeader {
  readonly type: "transfer";
  readonly toStoreroomId: string;
  readonly lines: readonly DocumentLine[];
}

/**
 * The documents that move stock (spec section 3). Invoices wait for the discovery session, and
 * sales imports feed variance, not movements.
 */
export type Document =
  DeliveryNote | WasteDocument | CountDocument | TransferDocument;

/** Why a document can't be posted or reversed: about one line, or about the whole document. */
export interface PostingError {
  readonly lineId?: string;
  readonly message: string;
}

/**
 * All or nothing (invariant 4): the posted document and every movement it adds, or the errors
 * and no movements at all.
 */
export type PostingResult =
  | {
      readonly ok: true;
      readonly document: Document;
      readonly movements: readonly Movement[];
    }
  | { readonly ok: false; readonly errors: readonly PostingError[] };

export interface PostingContext {
  /** Everything posted so far: on-hand stock, average costs and invariant 6 come from it. */
  readonly movements: readonly Movement[];
  readonly conversions: readonly UnitConversion[];
  /** A new unique ID on each call, for movements (the API passes crypto.randomUUIDv7). */
  readonly newId: () => string;
}

function failed(...errors: PostingError[]): PostingResult {
  return { ok: false, errors };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The movements accepted so far, and the lines that failed. */
interface LinesOutcome {
  readonly accepted: readonly Movement[];
  readonly errors: readonly PostingError[];
}

/**
 * Turns lines into movements one at a time, in order. Each line's movements go through
 * `appendMovements` after the lines before it (invariant 6). A line that throws is recorded as
 * an error and adds nothing; the next lines are still checked, so every failing line is reported.
 */
function postLines<L extends DocumentLine>(
  lines: readonly L[],
  movements: readonly Movement[],
  movementsOf: (line: L) => Movement[],
): LinesOutcome {
  let accepted = movements;
  const errors: PostingError[] = [];
  for (const line of lines) {
    try {
      accepted = appendMovements(accepted, movementsOf(line));
    } catch (error) {
      errors.push({ lineId: line.id, message: messageOf(error) });
    }
  }
  return { accepted, errors };
}

/**
 * Posts a document: turns its lines into movements, all or none (invariant 4). Every movement
 * points to its line (invariant 2), and the document passed in is never changed (invariant 7);
 * the result has a posted copy.
 *
 * - Delivery note: a receipt of the line's quantity, at its received unit cost.
 * - Waste: the quantity out, at the average cost.
 * - Count: counted − on hand, at the average cost. A line that matches the stock posts 0.
 * - Transfer: out of the storeroom and into the other one, both at the source's average cost.
 *
 * Costs and on-hand stock come from the movements posted before this document. A line that takes
 * stock below zero fails unless it has the adjustment flag (invariant 6). Every failing line is
 * reported.
 */
export function postDocument(
  document: Document,
  { movements, conversions, newId }: PostingContext,
): PostingResult {
  if (document.status === "posted") {
    return failed({ message: `document ${document.id} is already posted` });
  }
  if (document.lines.length === 0) {
    return failed({ message: `document ${document.id} has no lines` });
  }

  const { storeroomId } = document;
  const movement = (
    line: DocumentLine,
    storeroom: string,
    quantity: Quantity,
    unitCost: UnitCost,
    kind: MovementKind,
  ): Movement => ({
    id: newId(),
    productId: line.productId,
    storeroomId: storeroom,
    quantity,
    unitCost,
    documentLineId: line.id,
    kind,
    // The flag goes on the movement that takes stock out.
    ...(line.adjustment === true && quantity < 0
      ? { adjustment: true as const }
      : {}),
  });
  const baseUnits = (line: DocumentLine) => toBaseUnits(line, conversions);
  const positiveBaseUnits = (line: DocumentLine) => {
    const quantity = baseUnits(line);
    if (quantity <= 0) {
      throw new RangeError(
        `a ${document.type} quantity must be positive, got ${line.quantity} ${line.unit}`,
      );
    }
    return quantity;
  };
  const average = (line: DocumentLine) =>
    averageCost(movements, line.productId, storeroomId);

  const outcome = ((): LinesOutcome => {
    switch (document.type) {
      case "delivery-note":
        return postLines(document.lines, movements, (line) => {
          const quantity = baseUnits(line);
          const total = lineTotal({
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
          });
          const cost = receivedUnitCost(total, quantity);
          return [movement(line, storeroomId, quantity, cost, "receipt")];
        });
      case "waste":
        return postLines(document.lines, movements, (line) => [
          movement(
            line,
            storeroomId,
            0 - positiveBaseUnits(line),
            average(line),
            "waste",
          ),
        ]);
      case "count": {
        const counted = new Set<string>();
        return postLines(document.lines, movements, (line) => {
          if (counted.has(line.productId)) {
            throw new Error(
              `product ${line.productId} is counted twice in this count`,
            );
          }
          counted.add(line.productId);
          const quantity = baseUnits(line);
          if (quantity < 0) {
            throw new RangeError(
              `a counted quantity can't be negative, got ${line.quantity} ${line.unit}`,
            );
          }
          const onHand = stockOnHand(movements, line.productId, storeroomId);
          const difference = addQuantities(quantity, 0 - onHand);
          return [
            movement(line, storeroomId, difference, average(line), "count"),
          ];
        });
      }
      case "transfer": {
        const { toStoreroomId } = document;
        return postLines(document.lines, movements, (line) => {
          const quantity = positiveBaseUnits(line);
          const cost = average(line);
          return [
            movement(line, storeroomId, 0 - quantity, cost, "transfer-out"),
            movement(line, toStoreroomId, quantity, cost, "transfer-in"),
          ];
        });
      }
    }
  })();

  const errors: PostingError[] = [...outcome.errors];
  if (
    document.type === "transfer" &&
    document.toStoreroomId === document.storeroomId
  ) {
    errors.unshift({
      message: `document ${document.id} transfers from ${document.storeroomId} to ${document.toStoreroomId}; a transfer must go to another storeroom`,
    });
  }
  if (errors.length > 0) return failed(...errors);
  return {
    ok: true,
    document: { ...document, status: "posted" },
    movements: outcome.accepted.slice(movements.length),
  };
}

export interface ReversalDetails {
  /** The reversing document's ID and date, passed in. */
  readonly id: string;
  readonly date: string;
  /** A new unique ID on each call, for the reversing lines and movements. */
  readonly newId: () => string;
}

/** Lines copied under new IDs, each paired with the line it copies. */
function copyLines<L extends DocumentLine>(
  lines: readonly L[],
  newId: () => string,
): { lines: L[]; pairs: { original: L; copy: L }[] } {
  const pairs = lines.map((original) => ({
    original,
    copy: { ...original, id: newId() },
  }));
  return { lines: pairs.map((p) => p.copy), pairs };
}

/**
 * Reverses a posted document: a new posted document of the same type, with `reverses` set and a
 * copy of each line under a new ID, plus a reversing movement for each of the original's
 * movements, pointing to the copied line. The original and the movements given are never
 * changed (invariant 7). A correction is this reversal plus a new posted document.
 *
 * The movements are reversed last first, so stock passes back through the levels posting went
 * through. Each goes through `appendMovements` (invariant 6): reversing a delivery note whose
 * stock was already used fails, so post the corrected document first. All or nothing, like
 * posting.
 */
export function reverseDocument(
  posted: Document,
  movements: readonly Movement[],
  { id, date, newId }: ReversalDetails,
): PostingResult {
  if (posted.status !== "posted") {
    return failed({
      message: `document ${posted.id} is not posted (status ${posted.status})`,
    });
  }
  if (posted.reverses !== undefined) {
    return failed({
      message: `document ${posted.id} is itself a reversal (of ${posted.reverses}); post a new document instead`,
    });
  }

  // Two identical branches: in each, TypeScript knows the lines' type, so the copies keep it
  // (a delivery note's lines keep their prices).
  const header = { id, date, reverses: posted.id };
  let document: Document;
  let pairs: readonly { original: DocumentLine; copy: DocumentLine }[];
  if (posted.type === "delivery-note") {
    const copied = copyLines(posted.lines, newId);
    document = { ...posted, ...header, lines: copied.lines };
    pairs = copied.pairs;
  } else {
    const copied = copyLines(posted.lines, newId);
    document = { ...posted, ...header, lines: copied.lines };
    pairs = copied.pairs;
  }

  const toReverse = pairs.flatMap(({ original, copy }) =>
    movements
      .filter(
        (m) => m.documentLineId === original.id && m.reverses === undefined,
      )
      .map((movement) => ({ movement, line: original, copy })),
  );
  if (toReverse.length === 0) {
    return failed({
      message: `document ${posted.id} has no movements in the movements given`,
    });
  }

  let accepted = movements;
  const errors: PostingError[] = [];
  for (const { movement, line, copy } of toReverse.reverse()) {
    try {
      const reversal = reverseMovement(movement, accepted, {
        id: newId(),
        documentLineId: copy.id,
      });
      accepted = appendMovements(accepted, [reversal]);
    } catch (error) {
      errors.push({ lineId: line.id, message: messageOf(error) });
    }
  }

  if (errors.length > 0) return failed(...errors);
  return { ok: true, document, movements: accepted.slice(movements.length) };
}
