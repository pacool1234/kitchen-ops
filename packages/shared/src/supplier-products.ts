import { z } from "zod";
import { ListStatus, PageQuery, pageOf, SearchText } from "./lists";
import { BaseUnit, UnitName } from "./products";

// Supplier products (spec section 3, #88): how a supplier names and packs one of our products.
// "Tomate pera, caja de 6 kg", code TOM-6, is our Tomate pera in a pack of 6 kg.

/** The largest pack quantity: with MAX_FACTOR, a pack's base units stay a safe integer. */
export const MAX_PACK_QUANTITY = 100_000;

/** "25.500000" → "25.5": a decimal without trailing zeros, as the API answers it. */
export function canonicalQuantity(quantity: string): string {
  const [whole = "0", fraction = ""] = quantity.split(".");
  const digits = whole.replace(/^0+(?=\d)/, "");
  const decimals = fraction.replace(/0+$/, "");
  return decimals ? `${digits}.${decimals}` : digits;
}

/** How much of the product's unit a pack holds: a decimal with up to 6 places, above 0. */
export const PackQuantity = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,6})?$/)
  .transform(canonicalQuantity)
  .superRefine((quantity, ctx) => {
    // Compared as text and bigint, never as a JavaScript number: "0.000001" stays exact.
    const [whole = "0", fraction = ""] = quantity.split(".");
    const units = BigInt(whole);
    const max = BigInt(MAX_PACK_QUANTITY);
    if (units === 0n && fraction === "") {
      ctx.addIssue({
        code: "too_small",
        origin: "number",
        minimum: 0,
        inclusive: false,
        input: quantity,
      });
    } else if (units > max || (units === max && fraction !== "")) {
      ctx.addIssue({
        code: "too_big",
        origin: "number",
        maximum: MAX_PACK_QUANTITY,
        inclusive: true,
        input: quantity,
      });
    }
  });

/** A pack: a quantity in one of the product's units, its base unit included. */
export const Pack = z.strictObject({ quantity: PackQuantity, unit: UnitName });
export type Pack = z.infer<typeof Pack>;

const Code = z.string().trim().min(1).max(50);
const Description = z.string().trim().min(1).max(200);

export const SupplierProduct = z.object({
  id: z.uuid(),
  supplier: z.object({ id: z.uuid(), name: z.string() }),
  /** The supplier's own code, unique per supplier. */
  code: z.string(),
  description: z.string(),
  product: z.object({ id: z.uuid(), name: z.string(), baseUnit: BaseUnit }),
  pack: z.object({ quantity: z.string(), unit: z.string() }),
  /** The pack in the product's base units, from its current conversions (packages/ledger). */
  packBaseUnits: z.number().int(),
  active: z.boolean(),
});
export type SupplierProduct = z.infer<typeof SupplierProduct>;

/** Body of `POST /api/supplier-products`. */
export const NewSupplierProduct = z.strictObject({
  supplierId: z.uuid(),
  code: Code,
  description: Description,
  productId: z.uuid(),
  pack: Pack,
});
export type NewSupplierProduct = z.infer<typeof NewSupplierProduct>;

/** Body of `PATCH /api/supplier-products/:id`: only what changes. The supplier never does. */
export const SupplierProductChanges = z.strictObject({
  code: Code.optional(),
  description: Description.optional(),
  productId: z.uuid().optional(),
  pack: Pack.optional(),
  active: z.boolean().optional(),
});
export type SupplierProductChanges = z.infer<typeof SupplierProductChanges>;

/** Query of `GET /api/supplier-products`: `q` looks in the code and the description. */
export const SupplierProductQuery = PageQuery.extend({
  q: SearchText,
  supplierId: z.uuid().optional(),
  productId: z.uuid().optional(),
  status: ListStatus,
});
export type SupplierProductQuery = z.infer<typeof SupplierProductQuery>;

export const SupplierProductPage = pageOf(SupplierProduct);
export type SupplierProductPage = z.infer<typeof SupplierProductPage>;
