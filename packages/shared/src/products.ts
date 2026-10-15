import { z } from "zod";

/** The unit a product's stock is counted in (spec section 3). */
export const BASE_UNITS = ["g", "ml", "unit"] as const;
export const BaseUnit = z.enum(BASE_UNITS);
export type BaseUnit = z.infer<typeof BaseUnit>;

export const Product = z.object({
  id: z.uuid(),
  name: z.string(),
  baseUnit: BaseUnit,
  active: z.boolean(),
});
export type Product = z.infer<typeof Product>;

/** Response of `GET /api/products`. */
export const ProductList = z.object({ products: z.array(Product) });
export type ProductList = z.infer<typeof ProductList>;
