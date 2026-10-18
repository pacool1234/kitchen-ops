import type { BaseUnit } from "@kitchen-ops/shared";

// Made-up products for the gallery's combobox and table: no real supplier or client data.

export interface SampleProduct {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  /** In base units: grams, millilitres or thousandths of a unit (decision 0010). */
  stock: number;
  /** Euros per base unit, up to 6 decimals, as the API sends it. */
  unitCost: string;
  status: "active" | "low" | "inactive";
}

const rows: [string, BaseUnit, number, string][] = [
  ["Aceite de girasol", "ml", 18_000, "0.002150"],
  ["Aceite de oliva virgen extra", "ml", 25_000, "0.008900"],
  ["Aceitunas", "g", 3_500, "0.006400"],
  ["Ajo", "g", 1_200, "0.004800"],
  ["Albahaca", "g", 150, "0.032000"],
  ["Alcachofa", "unit", 24_000, "0.000650"],
  ["Arroz bomba", "g", 10_000, "0.003900"],
  ["Atún en conserva", "unit", 36_000, "0.002750"],
  ["Azúcar", "g", 5_000, "0.001100"],
  ["Bacalao", "g", 4_000, "0.016500"],
  ["Berenjena", "g", 6_250, "0.002300"],
  ["Calabacín", "g", 7_500, "0.001900"],
  ["Cebolla", "g", 12_000, "0.001200"],
  ["Champiñón", "g", 2_000, "0.004500"],
  ["Chocolate negro", "g", 2_500, "0.012800"],
  ["Gambas", "g", 3_000, "0.021000"],
  ["Garbanzos", "g", 8_000, "0.002600"],
  ["Harina de trigo", "g", 25_000, "0.000850"],
  ["Huevos", "unit", 180_000, "0.000230"],
  ["Jamón ibérico", "g", 2_750, "0.089000"],
  ["Judías verdes", "g", 4_500, "0.003200"],
  ["Leche entera", "ml", 30_000, "0.000950"],
  ["Lechuga", "unit", 18_000, "0.000700"],
  ["Lentejas", "g", 9_000, "0.002100"],
  ["Limón", "unit", 40_000, "0.000250"],
  ["Mantequilla", "g", 4_000, "0.009500"],
  ["Mejillones", "g", 5_000, "0.004200"],
  ["Merluza", "g", 6_000, "0.013900"],
  ["Nata para cocinar", "ml", 12_000, "0.003100"],
  ["Naranja", "unit", 60_000, "0.000300"],
  ["Ñora", "unit", 50_000, "0.000180"],
  ["Pan de barra", "unit", 40_000, "0.000600"],
  ["Patata", "g", 50_000, "0.000750"],
  ["Pimentón de la Vera", "g", 500, "0.024000"],
  ["Pimiento rojo", "g", 5_500, "0.002800"],
  ["Piña", "unit", 6_000, "0.001850"],
  ["Pollo", "g", 15_000, "0.005400"],
  ["Queso manchego", "g", 3_250, "0.018500"],
  ["Sal", "g", 8_000, "0.000400"],
  ["Tomate", "g", 20_000, "0.001850"],
  ["Vinagre de Jerez", "ml", 5_000, "0.004600"],
  ["Zanahoria", "g", 9_500, "0.001000"],
];

const products: SampleProduct[] = rows.map(
  ([name, baseUnit, stock, unitCost], i) => ({
    id: `p${i + 1}`,
    name,
    baseUnit,
    stock,
    unitCost,
    status: i % 9 === 4 ? "inactive" : stock < 2_000 ? "low" : "active",
  }),
);

/**
 * The 42 products out of alphabetical order, so sorting the table shows: every 17th, going
 * round. 17 and 42 share no factor, so each product comes exactly once.
 */
export const sampleProducts: SampleProduct[] = products.map(
  (_, i) => products[(i * 17) % products.length]!,
);
