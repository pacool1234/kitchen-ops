import { z } from "zod";
import { Name, OptionalEmail, OptionalPhone, optionalText } from "./fields";
import { ListStatus, PageQuery, pageOf, SearchText } from "./lists";
import { TaxId } from "./tax-id";

// Suppliers (spec section 3, #88): who the restaurant buys from. Each has a Spanish tax ID that
// passes its checksum, stored in one form (normalizeTaxId) and unique.

export const Supplier = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Normalized: "B00123455". */
  taxId: z.string(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  active: z.boolean(),
});
export type Supplier = z.infer<typeof Supplier>;

const ContactName = optionalText(100);

/** Body of `POST /api/suppliers`. The contact fields may be left out or blank. */
export const NewSupplier = z.strictObject({
  name: Name,
  taxId: TaxId,
  contactName: ContactName.optional(),
  email: OptionalEmail.optional(),
  phone: OptionalPhone.optional(),
});
export type NewSupplier = z.infer<typeof NewSupplier>;

/**
 * Body of `PATCH /api/suppliers/:id`: only the fields to change. A contact field sent as null or
 * blank is cleared; one not sent stays as it is. `active: false` deactivates.
 */
export const SupplierChanges = z.strictObject({
  name: Name.optional(),
  taxId: TaxId.optional(),
  contactName: ContactName.optional(),
  email: OptionalEmail.optional(),
  phone: OptionalPhone.optional(),
  active: z.boolean().optional(),
});
export type SupplierChanges = z.infer<typeof SupplierChanges>;

/** Query of `GET /api/suppliers`: `q` looks in the name and the tax ID. */
export const SupplierQuery = PageQuery.extend({
  q: SearchText,
  status: ListStatus,
});
export type SupplierQuery = z.infer<typeof SupplierQuery>;

export const SupplierPage = pageOf(Supplier);
export type SupplierPage = z.infer<typeof SupplierPage>;
