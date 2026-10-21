import { toBaseUnits, type UnitConversion } from "./conversion";
import { averageCost, receivedUnitCost } from "./cost";
import { lineTotal, type UnitCost } from "./money";
import {
  appendMovements,
  latestVersionOf,
  reverseMovement,
  stockOnHand,
  type Movement,
  type MovementKind,
} from "./movement";
import { standingReceipt } from "./invoice";
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
  /**
   * Where this line's goods are received, if not the document's storeroom: each product's own,
   * say (#116). An invoice line that bills a delivery-note line ignores it: its correction stays
   * where the goods were received. Decision 0033.
   */
  readonly storeroomId?: string;
}

/**
 * An invoice line also has a price, and may bill a delivery-note line (decision 0032). Billing
 * one corrects its price; billing none receives the line like a delivery-note line.
 */
export interface InvoiceLine extends DeliveryNoteLine {
  /** The posted delivery-note line this line bills, if any. */
  readonly deliveryNoteLineId?: string;
}

interface DocumentHeader {
  /** Passed in, never generated here. */
  readonly id: string;
  /** An ISO date ("2026-10-16"), kept as text. The ledger never reads it. */
  readonly date: string;
  /** The number printed on the document, if it has one. */
  readonly number?: string;
  readonly status: DocumentStatus;
  /**
   * Where the stock is: received into, wasted from, counted in, or transferred from. A received
   * line may name its own (decision 0033). An invoice's corrections stay where the goods were
   * received.
   */
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

/**
 * A supplier's invoice (decision 0032): corrects the prices of the delivery-note lines it bills,
 * and receives its other lines, like a delivery note, for a supplier that sends no delivery notes.
 */
export interface Invoice extends DocumentHeader {
  readonly type: "invoice";
  readonly supplierId: string;
  readonly lines: readonly InvoiceLine[];
}

/** Stock thrown away: removes it at the average cost. */
export interface WasteDocument extends DocumentHeader {
  readonly type: "waste";
  readonly lines: readonly DocumentLine[];
}

/** A physical count: each line is the quantity counted in the storeroom. */
export interface CountDocument extends DocumentHeader {
  readonly type: "count";
  /** Placeholder for #148: the tests come first. */
  readonly movementsBeforeCount?: number;
  readonly lines: readonly DocumentLine[];
}

/** Stock moved from `storeroomId` to `toStoreroomId`, carrying its average cost. */
export interface TransferDocument extends DocumentHeader {
  readonly type: "transfer";
  readonly toStoreroomId: string;
  readonly lines: readonly DocumentLine[];
}

/** The documents that move stock (spec section 3). Sales imports feed variance, not movements. */
export type Document =
  DeliveryNote | Invoice | WasteDocument | CountDocument | TransferDocument;

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
 * - Delivery note: a receipt of the line's quantity, at its received unit cost, into the line's
 *   storeroom if it names one.
 * - Invoice: for a line billing a delivery-note line at another unit cost, a receipt at the
 *   invoice's cost correcting the delivery note's, and that one's reversal; nothing at the same
 *   cost. A line billing nothing is received like a delivery-note line (decision 0032).
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
  const receive = (line: DeliveryNoteLine): Movement[] => {
    const quantity = baseUnits(line);
    const cost = receivedUnitCost(lineTotalOf(line), quantity);
    const into = line.storeroomId ?? storeroomId;
    return [movement(line, into, quantity, cost, "receipt")];
  };

  const outcome = ((): LinesOutcome => {
    switch (document.type) {
      case "delivery-note":
        return postLines(document.lines, movements, receive);
      case "invoice": {
        const billed = new Set<string>();
        const latest = latestVersionOf(movements);
        return postLines(document.lines, movements, (line) => {
          const { deliveryNoteLineId } = line;
          if (deliveryNoteLineId === undefined) return receive(line);
          if (billed.has(deliveryNoteLineId)) {
            throw new Error(
              `delivery-note line ${deliveryNoteLineId} is billed twice in this invoice`,
            );
          }
          billed.add(deliveryNoteLineId);
          const current = billedReceipt(movements, latest, deliveryNoteLineId);
          if (current.productId !== line.productId) {
            throw new Error(
              `delivery-note line ${deliveryNoteLineId} received ${current.productId}, not ${line.productId}`,
            );
          }
          const quantity = baseUnits(line);
          if (quantity !== current.quantity) {
            throw new Error(
              `the invoice bills ${quantity} base units of ${line.productId}, but delivery-note line ${deliveryNoteLineId} received ${current.quantity}`,
            );
          }
          const cost = receivedUnitCost(lineTotalOf(line), quantity);
          if (cost === current.unitCost) return [];
          return correction(current, cost, movements, {
            id: newId(),
            reversalId: newId(),
            documentLineId: line.id,
          });
        });
      }
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

function lineTotalOf(line: DeliveryNoteLine) {
  return lineTotal({
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
  });
}

/**
 * The receipt that stands for a delivery-note line's goods now (`standingReceipt`). Throws,
 * saying why, if there is none: no receipt, or one that was reversed.
 */
function billedReceipt(
  movements: readonly Movement[],
  latest: (movement: Movement) => Movement,
  deliveryNoteLineId: string,
): Movement {
  const current = standingReceipt(movements, deliveryNoteLineId, latest);
  if (current !== undefined) return current;
  const received = movements.some(
    (m) => m.documentLineId === deliveryNoteLineId && m.kind === "receipt",
  );
  throw new Error(
    received
      ? `delivery-note line ${deliveryNoteLineId} was reversed: there is no received stock to bill`
      : `delivery-note line ${deliveryNoteLineId} has no receipt in the movements given`,
  );
}

/**
 * A receipt at a new unit cost correcting `current`, and `current`'s reversal (decision 0032).
 * Both point to `documentLineId`. The one that adds stock goes first, so stock never dips: the
 * correction for goods received, the reversal for a return.
 */
function correction(
  current: Movement,
  unitCost: UnitCost,
  movements: readonly Movement[],
  {
    id,
    reversalId,
    documentLineId,
  }: { id: string; reversalId: string; documentLineId: string },
): Movement[] {
  const corrected: Movement = {
    id,
    productId: current.productId,
    storeroomId: current.storeroomId,
    quantity: current.quantity,
    unitCost,
    documentLineId,
    kind: current.kind,
    corrects: current.id,
  };
  const reversal = reverseMovement(current, movements, {
    id: reversalId,
    documentLineId,
  });
  return current.quantity > 0 ? [corrected, reversal] : [reversal, corrected];
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
 * A receipt an invoice corrected is taken out as it stands now: its last correction is the one
 * reversed. Reversing an invoice puts back the price each line replaced, with a correction and a
 * reversal (decision 0032); an invoice that corrected nothing reverses with no movements.
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
  // (a delivery note's and an invoice's lines keep their prices).
  const header = { id, date, reverses: posted.id };
  let document: Document;
  let pairs: readonly { original: DocumentLine; copy: DocumentLine }[];
  if (posted.type === "delivery-note" || posted.type === "invoice") {
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
  if (toReverse.length === 0 && posted.type !== "invoice") {
    return failed({
      message: `document ${posted.id} has no movements in the movements given`,
    });
  }

  const latest = latestVersionOf(movements);
  const byId = new Map(movements.map((m) => [m.id, m]));
  let accepted = movements;
  const errors: PostingError[] = [];
  for (const { movement, line, copy } of toReverse.reverse()) {
    try {
      const current = latest(movement);
      let added: Movement[];
      if (movement.corrects === undefined) {
        added = [
          reverseMovement(current, accepted, {
            id: newId(),
            documentLineId: copy.id,
          }),
        ];
      } else {
        // An invoice's correction: put back the price of the receipt it replaced.
        const replaced = byId.get(movement.corrects);
        if (replaced === undefined) {
          throw new Error(
            `movement ${movement.id} corrects ${movement.corrects}, which is not in the movements given`,
          );
        }
        added =
          replaced.unitCost === current.unitCost
            ? []
            : correction(current, replaced.unitCost, accepted, {
                id: newId(),
                reversalId: newId(),
                documentLineId: copy.id,
              });
      }
      accepted = appendMovements(accepted, added);
    } catch (error) {
      errors.push({ lineId: line.id, message: messageOf(error) });
    }
  }

  if (errors.length > 0) return failed(...errors);
  return { ok: true, document, movements: accepted.slice(movements.length) };
}
