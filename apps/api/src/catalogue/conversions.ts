import {
  toBaseUnits,
  type UnitConversion as LedgerConversion,
} from "@kitchen-ops/ledger";
import {
  BASE_UNIT_FACTOR,
  type BaseUnit,
  type FieldErrorCode,
  type UnitConversion,
} from "@kitchen-ops/shared";

// Products' unit conversions and supplier products' packs (#88), converted by packages/ledger, so
// the catalogue turns purchase units into base units exactly as posting will (M7).

/** What converting needs of a product: its ID, its base unit and its conversions. */
export interface ConvertibleProduct {
  readonly id: string;
  readonly baseUnit: BaseUnit;
  readonly conversions: readonly UnitConversion[];
}

/** A product's conversions as the ledger takes them: its base unit's own first, then the rest. */
export function ledgerConversions(
  product: ConvertibleProduct,
): LedgerConversion[] {
  return [
    {
      productId: product.id,
      unit: product.baseUnit,
      factor: BASE_UNIT_FACTOR[product.baseUnit],
    },
    ...product.conversions.map((c) => ({ productId: product.id, ...c })),
  ];
}

export type PackResult =
  | { readonly baseUnits: number }
  | { readonly refused: "unknown_unit" | "not_whole_base_units" };

/**
 * A pack in the product's base units: 6 kg of tomatoes is 6000 g. Refused if its unit isn't one
 * of the product's (matched exactly, as the ledger does), or if it isn't a whole number of base
 * units. The limits on factors and pack quantities keep every other result a safe integer.
 */
export function packBaseUnits(
  product: ConvertibleProduct,
  pack: { readonly quantity: string; readonly unit: string },
): PackResult {
  const conversions = ledgerConversions(product);
  if (!conversions.some((c) => c.unit === pack.unit)) {
    return { refused: "unknown_unit" };
  }
  try {
    return {
      baseUnits: toBaseUnits({ productId: product.id, ...pack }, conversions),
    };
  } catch (error) {
    // The ledger's refusal of a fraction of a base unit: 0.0001 kg is 0.1 g.
    if (error instanceof RangeError) return { refused: "not_whole_base_units" };
    throw error;
  }
}

/**
 * What new conversions would break, by field: a removed conversion a pack uses (`conversions`),
 * or a factor that leaves a pack a fraction of a base unit (`conversions.N.factor`). Empty if
 * every pack still converts.
 */
export function packsBroken(
  product: ConvertibleProduct,
  packs: readonly { readonly quantity: string; readonly unit: string }[],
): Record<string, FieldErrorCode> {
  const fields: Record<string, FieldErrorCode> = {};
  for (const pack of packs) {
    const result = packBaseUnits(product, pack);
    if (!("refused" in result)) continue;
    const index = product.conversions.findIndex((c) => c.unit === pack.unit);
    if (index === -1) fields.conversions = "in_use";
    else fields[`conversions.${index}.factor`] = "in_use";
  }
  return fields;
}
