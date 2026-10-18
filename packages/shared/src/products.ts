import { z } from "zod";
import type { FieldErrorCode } from "./errors";
import { Name } from "./fields";
import { ListStatus, PageQuery, pageOf, SearchText } from "./lists";

// Products and their unit conversions (spec section 3, #88).

/** The unit a product's stock is counted in (spec section 3). */
export const BASE_UNITS = ["g", "ml", "unit"] as const;
export const BaseUnit = z.enum(BASE_UNITS);
export type BaseUnit = z.infer<typeof BaseUnit>;

/**
 * Base units per base unit's name: quantities are whole grams, millilitres, or thousandths of a
 * unit (spec section 4), so one "unit" is 1000. The API adds this conversion to every product.
 */
export const BASE_UNIT_FACTOR: Readonly<Record<BaseUnit, number>> = {
  g: 1,
  ml: 1,
  unit: 1000,
};

/** What a product is, for lists, reports and (later) food and drink costs. */
export const PRODUCT_CATEGORIES = [
  "produce",
  "meat",
  "fish",
  "dairy",
  "bakery",
  "dry_goods",
  "frozen",
  "drinks",
  "cleaning",
  "other",
] as const;
export const ProductCategory = z.enum(PRODUCT_CATEGORIES);
export type ProductCategory = z.infer<typeof ProductCategory>;

/** The largest factor: a Postgres integer. With MAX_PACK_QUANTITY, a pack stays a safe integer. */
export const MAX_FACTOR = 2_147_483_647;

/** A unit's name, as documents print it: "caja", "kg", "botella". */
export const UnitName = z.string().trim().min(1).max(20);

/** How many base units one of a purchase unit holds (packages/ledger's UnitConversion). */
export const UnitConversion = z.object({
  unit: z.string(),
  factor: z.number().int(),
});
export type UnitConversion = z.infer<typeof UnitConversion>;

export const NewUnitConversion = z.strictObject({
  unit: UnitName,
  factor: z.number().int().min(1).max(MAX_FACTOR),
});

const Conversions = z.array(NewUnitConversion).max(30);

/**
 * What's wrong with a product's conversions, by field: a unit twice, whatever its case
 * (`taken`), or the base unit's own name (`reserved`: the API adds it). Empty if nothing is.
 */
export function checkConversions(
  baseUnit: BaseUnit,
  conversions: readonly UnitConversion[],
): Record<string, FieldErrorCode> {
  const fields: Record<string, FieldErrorCode> = {};
  const seen = new Set<string>();
  conversions.forEach(({ unit }, i) => {
    const key = unit.toLowerCase();
    if (key === baseUnit) fields[`conversions.${i}.unit`] = "reserved";
    else if (seen.has(key)) fields[`conversions.${i}.unit`] = "taken";
    seen.add(key);
  });
  return fields;
}

export const Product = z.object({
  id: z.uuid(),
  name: z.string(),
  baseUnit: BaseUnit,
  category: ProductCategory,
  defaultStoreroomId: z.uuid().nullable(),
  active: z.boolean(),
  /** Smallest factor first. The base unit's own isn't listed: every product has it. */
  conversions: z.array(UnitConversion),
});
export type Product = z.infer<typeof Product>;

/** Body of `POST /api/products`. The name is unique, whatever its case. */
export const NewProduct = z.strictObject({
  name: Name,
  baseUnit: BaseUnit,
  category: ProductCategory,
  defaultStoreroomId: z.uuid().nullable().optional(),
  conversions: Conversions.default([]),
});
export type NewProduct = z.infer<typeof NewProduct>;

/**
 * Body of `PATCH /api/products/:id`: only the fields to change. Conversions sent replace the
 * product's list. The base unit can't change: stock will be counted in it.
 */
export const ProductChanges = z.strictObject({
  name: Name.optional(),
  category: ProductCategory.optional(),
  defaultStoreroomId: z.uuid().nullable().optional(),
  conversions: Conversions.optional(),
  active: z.boolean().optional(),
});
export type ProductChanges = z.infer<typeof ProductChanges>;

/** Query of `GET /api/products`. */
export const ProductQuery = PageQuery.extend({
  q: SearchText,
  category: ProductCategory.optional(),
  /** Products whose default storeroom is this one. */
  storeroomId: z.uuid().optional(),
  status: ListStatus,
});
export type ProductQuery = z.infer<typeof ProductQuery>;

export const ProductPage = pageOf(Product);
export type ProductPage = z.infer<typeof ProductPage>;
