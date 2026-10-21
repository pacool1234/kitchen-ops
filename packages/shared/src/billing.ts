import { z } from "zod";
import { BaseUnit } from "./products";

// Which delivery-note line each line of an invoice bills (#120, decisions 0032 and 0041). The
// API suggests a line when it's the only candidate on both sides; office and owner confirm it,
// choose another, or receive the line with the invoice, as an invoice-only supplier's are.
// Prices are unit costs per base unit, 6 decimals as text; differences are euros, 2 decimals.

/** A posted delivery-note line an invoice line may bill, with its price now. */
export const BillableLine = z.object({
  id: z.uuid(),
  deliveryNote: z.object({
    id: z.uuid(),
    number: z.string().nullable(),
    date: z.iso.date(),
  }),
  /** From 1, in its delivery note's order. */
  position: z.number().int().min(1),
  product: z.object({ id: z.uuid(), name: z.string(), baseUnit: BaseUnit }),
  /** As printed on the delivery note, in `unit`. */
  quantity: z.string(),
  unit: z.string(),
  /** What was received, in base units: what an invoice line must bill. */
  baseQuantity: z.number().int(),
  /** Per base unit now: the receipt that stands for its goods, after any earlier invoice. */
  unitCost: z.string(),
});
export type BillableLine = z.infer<typeof BillableLine>;

/** A delivery-note line chosen for an invoice line, and how the invoice's price compares. */
const billed = {
  deliveryNoteLine: BillableLine,
  /** Per base unit at the invoice's price; null when it has none, or its quantity can't be converted. */
  invoiceUnitCost: z.string().nullable(),
  /** The invoice line's total less the delivery-note line's value now, in euros; null as above. */
  difference: z.string().nullable(),
  /** Whether the invoice bills the base units the delivery note received (decision 0032). */
  quantityMatches: z.boolean(),
};

/** An invoice line's choice: confirmed, only suggested, or received with the invoice. */
export const LineBilling = z.discriminatedUnion("by", [
  z.object({ by: z.literal("confirmed"), ...billed }),
  z.object({ by: z.literal("suggested"), ...billed }),
  z.object({ by: z.literal("received") }),
]);
export type LineBilling = z.infer<typeof LineBilling>;

/** One line's choice in `PUT /api/documents/:id/billing`; null undoes it. */
export const LineBillingChoice = z.union([
  z.strictObject({ deliveryNoteLineId: z.uuid() }),
  z.strictObject({ received: z.literal(true) }),
  z.null(),
]);
export type LineBillingChoice = z.infer<typeof LineBillingChoice>;

/** Body of `PUT /api/documents/:id/billing`: one choice per line of the draft, in order. */
export const DocumentBilling = z.strictObject({
  lines: z.array(LineBillingChoice),
});
export type DocumentBilling = z.infer<typeof DocumentBilling>;

/** Answer of `GET /api/documents/:id/billing/candidates`. */
export const BillingCandidates = z.object({
  lines: z.array(
    BillableLine.extend({
      /** The invoice line, from 1, it's confirmed for already; null if none. */
      chosenFor: z.number().int().min(1).nullable(),
    }),
  ),
});
export type BillingCandidates = z.infer<typeof BillingCandidates>;
