import {
  type FieldErrorCode,
  type Product,
  type StockLine,
} from "@kitchen-ops/shared";
import { packBaseUnits } from "../catalogue/units";

// Waste and transfers as a kitchen types them (#151): each line in kilos, litres or units, or in
// one of the product's purchase units ("caja"), and sent as the API takes them. Kilos and litres
// go in grams and millilitres, worked out on the decimal text, never with a JavaScript number's
// fractions; units and purchase units go as typed, for the API to convert.

/** The form's value for kilos, litres or units, whichever the product is counted in. */
export const KITCHEN_UNIT = "@kitchen";

/** A unit a line may be typed in, and how many base units one of it holds. */
export interface UnitChoice {
  value: string;
  factor: number;
}

/**
 * Kilos, litres or units first, then the product's purchase units, smallest first. A purchase
 * unit that is the same as the first ("kg" of 1000 g) isn't offered again.
 */
export function unitChoices(
  product: Pick<Product, "baseUnit" | "conversions">,
): UnitChoice[] {
  const kitchen = KITCHEN_NAMES[product.baseUnit];
  return [
    { value: KITCHEN_UNIT, factor: KITCHEN_FACTOR },
    ...product.conversions
      .filter(
        (c) =>
          !(
            c.factor === KITCHEN_FACTOR &&
            kitchen.includes(c.unit.trim().toLowerCase())
          ),
      )
      .map((c) => ({ value: c.unit, factor: c.factor })),
  ];
}

/** One kilo, litre or unit, in base units: grams, millilitres or thousandths (spec section 4). */
const KITCHEN_FACTOR = 1000;
/** What a purchase unit of 1000 base units may be called that means a kilo, litre or unit. */
const KITCHEN_NAMES: Record<Product["baseUnit"], readonly string[]> = {
  g: ["kg", "kilo", "kilos"],
  ml: ["l", "litro", "litros"],
  unit: ["ud", "ud.", "uds", "uds.", "unidad", "unidades"],
};

/** A line as typed: a product, a quantity as decimal text, and a unit (`KITCHEN_UNIT` or one of the product's). */
export interface LineValues {
  productId: string;
  quantity: string;
  unit: string;
}

/**
 * A line as the API takes it: 1.5 kg of tomatoes is 1500 g; 3 units are 3 of the base unit, which
 * the API counts in thousandths; a purchase unit goes as typed. With no product chosen, or a
 * quantity that isn't whole grams or millilitres, as typed, for the checks to refuse.
 */
export function stockLine(
  line: LineValues,
  product: Pick<Product, "baseUnit"> | undefined,
): StockLine {
  if (line.unit !== KITCHEN_UNIT || !product) return { ...line };
  const { productId, quantity } = line;
  if (product.baseUnit === "unit") return { productId, quantity, unit: "unit" };
  const baseUnits = packBaseUnits(quantity, KITCHEN_FACTOR);
  return {
    productId,
    quantity: baseUnits === null ? quantity : String(baseUnits),
    unit: product.baseUnit,
  };
}

/**
 * What the schema can't see: a quantity that isn't a whole number of the product's base units
 * in its unit ("1.2345" kg, "0.0001" garrafa of 5 l), by its field. What's missing is left to
 * the schema.
 */
export function lineErrors(
  lines: readonly LineValues[],
  products: ReadonlyMap<string, Pick<Product, "baseUnit" | "conversions">>,
): Record<string, FieldErrorCode> {
  const errors: Record<string, FieldErrorCode> = {};
  lines.forEach((line, i) => {
    const product = products.get(line.productId);
    const unit = product
      ? unitChoices(product).find((u) => u.value === line.unit)
      : undefined;
    if (!unit || line.quantity.trim() === "") return;
    if (packBaseUnits(line.quantity, unit.factor) === null) {
      errors[`lines.${i}.quantity`] = "not_whole_base_units";
    }
  });
  return errors;
}

/**
 * Sends under one ID until it's answered: a send whose answer was lost, sent again, is the same
 * request, which the API posts once (decision 0044). Answered, the next send is a new one.
 */
export function sendsOnce<T>(
  send: (id: string) => Promise<T>,
  newId: () => string = () => crypto.randomUUID(),
) {
  let id = newId();
  return {
    get id() {
      return id;
    },
    async send(): Promise<T> {
      const answer = await send(id);
      id = newId();
      return answer;
    },
  };
}
