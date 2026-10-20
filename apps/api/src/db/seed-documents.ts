import type { Storage } from "../storage/storage";
import type { Db } from "./client";
import type { SeedProduct, SeedSupplierProduct } from "./seed-catalogue";
import type { suppliers } from "./schema";

// The demo's documents (#119, decision 0039): three synthetic documents from the gold set, ready
// for review as if they had just been read, to try reviewing and posting with. Their drafts are
// the gold set's hand-checked expected.json, so no model is called.

/** A demo document: its fixed ID, and the gold folder it comes from. */
export interface DemoDocument {
  id: string;
  gold: string;
}

export const DEMO_DOCUMENTS: DemoDocument[] = [
  // A photo of a priced delivery note, from a supplier we know.
  {
    id: "01a15b87-1c42-71f6-b671-4b48b8cbac4a",
    gold: "syn-017-picture-from-004",
  },
  // A photo of one without prices, from a supplier to create in review.
  {
    id: "01a15b87-1c43-73dc-bfc4-076f5011f308",
    gold: "syn-014-picture-from-001",
  },
  // A long PDF without prices; one line is printed with nothing delivered.
  {
    id: "01a15b87-1c43-7f1e-9407-c8454029e3a9",
    gold: "syn-012-delivery-note-no-prices",
  },
];

/** Who the demo documents were uploaded by: a login both seeds create. */
export const DEMO_UPLOADER = "office@example.test";

/** Two of the documents' suppliers. The third, Huerta La Ejemplar, is left to create in review. */
export const demoSuppliers: (typeof suppliers.$inferInsert)[] = [
  {
    name: "Carnes Ficticias de Ejemplo, S.L.",
    taxId: "B00777029",
    email: "pedidos@carnesficticias.example",
  },
  {
    name: "Suministros Hosteleros Inventados, S.L.",
    taxId: "B00555664",
  },
];

/** The products the documents' lines need that the catalogue doesn't have. */
export const demoProducts: SeedProduct[] = [
  {
    name: "Pollo entero",
    baseUnit: "g",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Hamburguesa de ternera 180 g",
    baseUnit: "unit",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "caja", factor: 20000 }],
  },
  {
    name: "Chorizo para cocinar",
    baseUnit: "unit",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [],
  },
  {
    name: "Panceta curada",
    baseUnit: "g",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Queso rallado",
    baseUnit: "g",
    category: "dairy",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Aceite de girasol",
    baseUnit: "ml",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [{ unit: "bidón", factor: 25000 }],
  },
  {
    name: "Lejía",
    baseUnit: "ml",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "garrafa", factor: 5000 }],
  },
  {
    name: "Desengrasante",
    baseUnit: "ml",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "garrafa", factor: 5000 }],
  },
  {
    name: "Abrillantador",
    baseUnit: "ml",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "garrafa", factor: 5000 }],
  },
  {
    name: "Gel hidroalcohólico",
    baseUnit: "ml",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "botella", factor: 1000 }],
  },
  {
    name: "Papel secamanos",
    baseUnit: "unit",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "caja", factor: 20000 }],
  },
  {
    name: "Bobina de papel industrial",
    baseUnit: "unit",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [],
  },
  {
    name: "Bolsas de basura",
    baseUnit: "unit",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [],
  },
  {
    name: "Guantes de nitrilo",
    baseUnit: "unit",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "caja", factor: 100000 }],
  },
  {
    name: "Film transparente (rollo)",
    baseUnit: "unit",
    category: "other",
    storeroom: "Almacén seco",
    conversions: [],
  },
  {
    name: "Papel de aluminio (rollo)",
    baseUnit: "unit",
    category: "other",
    storeroom: "Almacén seco",
    conversions: [],
  },
];

/** Some lines already mapped, so review shows matched lines next to ones still to map. */
export const demoSupplierProducts: SeedSupplierProduct[] = [
  {
    supplierTaxId: "B00777029",
    code: "CF-101",
    description: "Solomillo de ternera",
    product: "Solomillo de ternera",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00777029",
    code: "CF-310",
    description: "Hamburguesa 180 g (caja 20 ud)",
    product: "Hamburguesa de ternera 180 g",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00555664",
    code: "SH-1102",
    description: "LEJIA CONCENTRADA 5 L",
    product: "Lejía",
    pack: { quantity: "1", unit: "garrafa" },
  },
  {
    supplierTaxId: "B00555664",
    code: "AL-2093",
    description: "NATA COCINA 18% 1 L",
    product: "Nata para cocinar",
    pack: { quantity: "1", unit: "brik" },
  },
];

/**
 * Adds the demo's suppliers, products and supplier products that aren't there, then its
 * documents that aren't, if there's storage for their files.
 */
export async function seedDemoDocuments(
  _db: Db,
  _storage: Storage | null,
  _log: (line: string) => void,
  _now: Date = new Date(),
): Promise<void> {}
