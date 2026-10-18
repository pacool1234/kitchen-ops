import type {
  BaseUnit,
  ProductCategory,
  UnitConversion,
} from "@kitchen-ops/shared";
import type { storerooms, suppliers } from "./schema";

// The fictional restaurant's catalogue (#88, spec 11.1), for local development, CI and the demo.
// Synthetic: the suppliers are made up, their emails are on the reserved .example domain, and
// their CIFs are in province 00, which doesn't exist, so they belong to no real company. The
// products are a realistic set for a Spanish restaurant's kitchen and bar.

/** A cold room, a dry store and the bar (spec 11.1). */
export const seedStorerooms: (typeof storerooms.$inferInsert)[] = [
  { name: "Cámara frigorífica", type: "cold_room" },
  { name: "Almacén seco", type: "dry_store" },
  { name: "Barra", type: "bar" },
];

export const seedSuppliers: (typeof suppliers.$inferInsert)[] = [
  {
    name: "Frutas y Verduras El Huerto, S.L.",
    taxId: "B00100016",
    contactName: "Lucía Ferrer",
    email: "pedidos@elhuerto.example",
  },
  {
    name: "Carnes Selectas Valle Alto, S.L.",
    taxId: "B00100024",
    contactName: "Andrés Molina",
    email: "pedidos@vallealto.example",
  },
  {
    name: "Pescados y Mariscos Costa Norte, S.L.",
    taxId: "B00100032",
    contactName: "Marta Iglesias",
    email: "lonja@costanorte.example",
  },
  {
    name: "Lácteos La Pradera, S.L.",
    taxId: "B00100040",
    email: "clientes@lapradera.example",
  },
  {
    name: "Horno de Leña El Trigal, S.L.",
    taxId: "B00100057",
    contactName: "Javier Ortega",
  },
  {
    name: "Ultramarinos y Distribución Sol, S.L.",
    taxId: "B00100065",
    contactName: "Elena Navarro",
    email: "pedidos@ultramarinossol.example",
  },
  {
    name: "Bebidas y Vinos Ribera Baja, S.L.",
    taxId: "B00100073",
    contactName: "Sergio Cano",
    email: "comercial@riberabaja.example",
  },
  {
    name: "Higiene Profesional Brillo, S.L.",
    taxId: "B00100081",
    email: "pedidos@brillo.example",
  },
];

/** A seeded product: its storeroom by name, since IDs only exist once it's seeded. */
export interface SeedProduct {
  name: string;
  baseUnit: BaseUnit;
  category: ProductCategory;
  storeroom: string;
  conversions: UnitConversion[];
  active?: false;
}

/** About 40 products, one of them discontinued. Factors are in base units (spec section 4). */
export const seedProducts: SeedProduct[] = [
  {
    name: "Tomate pera",
    baseUnit: "g",
    category: "produce",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "caja", factor: 6000 },
    ],
  },
  {
    name: "Cebolla",
    baseUnit: "g",
    category: "produce",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "saco", factor: 10000 },
    ],
  },
  {
    name: "Patata",
    baseUnit: "g",
    category: "produce",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "saco", factor: 25000 },
    ],
  },
  {
    name: "Pimiento rojo",
    baseUnit: "g",
    category: "produce",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "caja", factor: 5000 },
    ],
  },
  {
    name: "Lechuga romana",
    baseUnit: "unit",
    category: "produce",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "caja", factor: 12000 }],
  },
  {
    name: "Limones",
    baseUnit: "g",
    category: "produce",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "malla", factor: 2000 },
    ],
  },
  {
    name: "Ajo",
    baseUnit: "g",
    category: "produce",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Perejil (manojo)",
    baseUnit: "unit",
    category: "produce",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "caja", factor: 20000 }],
  },
  {
    name: "Pechuga de pollo",
    baseUnit: "g",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "bandeja", factor: 2500 },
    ],
  },
  {
    name: "Solomillo de ternera",
    baseUnit: "g",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Lomo de cerdo",
    baseUnit: "g",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "pieza", factor: 3000 },
    ],
  },
  {
    name: "Jamón ibérico loncheado",
    baseUnit: "g",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "sobre", factor: 100 },
      { unit: "kg", factor: 1000 },
    ],
  },
  {
    name: "Merluza",
    baseUnit: "g",
    category: "fish",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "caja", factor: 5000 },
    ],
  },
  {
    name: "Gambas",
    baseUnit: "g",
    category: "fish",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "caja", factor: 2000 },
    ],
  },
  {
    name: "Mejillones",
    baseUnit: "g",
    category: "fish",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "malla", factor: 2000 },
    ],
  },
  {
    name: "Bacalao desalado",
    baseUnit: "g",
    category: "fish",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Leche entera",
    baseUnit: "ml",
    category: "dairy",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "l", factor: 1000 },
      { unit: "caja", factor: 6000 },
    ],
  },
  {
    name: "Nata para cocinar",
    baseUnit: "ml",
    category: "dairy",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "brik", factor: 1000 },
      { unit: "caja", factor: 12000 },
    ],
  },
  {
    name: "Mantequilla",
    baseUnit: "g",
    category: "dairy",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "bloque", factor: 250 },
      { unit: "kg", factor: 1000 },
    ],
  },
  {
    name: "Queso manchego",
    baseUnit: "g",
    category: "dairy",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "cuña", factor: 250 },
      { unit: "kg", factor: 1000 },
    ],
  },
  {
    name: "Huevos camperos",
    baseUnit: "unit",
    category: "dairy",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "docena", factor: 12000 },
      { unit: "bandeja", factor: 30000 },
    ],
  },
  {
    name: "Pan de barra",
    baseUnit: "unit",
    category: "bakery",
    storeroom: "Almacén seco",
    conversions: [{ unit: "bolsa", factor: 10000 }],
  },
  {
    name: "Pan de molde",
    baseUnit: "unit",
    category: "bakery",
    storeroom: "Almacén seco",
    conversions: [],
  },
  {
    name: "Aceite de oliva virgen extra",
    baseUnit: "ml",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [
      { unit: "l", factor: 1000 },
      { unit: "garrafa", factor: 5000 },
    ],
  },
  {
    name: "Harina de trigo",
    baseUnit: "g",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "saco", factor: 25000 },
    ],
  },
  {
    name: "Arroz bomba",
    baseUnit: "g",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "saco", factor: 5000 },
    ],
  },
  {
    name: "Azúcar",
    baseUnit: "g",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Sal fina",
    baseUnit: "g",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Pimentón de la Vera",
    baseUnit: "g",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [{ unit: "lata", factor: 75 }],
  },
  {
    name: "Garbanzos",
    baseUnit: "g",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Tomate triturado",
    baseUnit: "g",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [
      { unit: "lata", factor: 800 },
      { unit: "caja", factor: 9600 },
    ],
  },
  {
    name: "Vinagre de Jerez",
    baseUnit: "ml",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [{ unit: "botella", factor: 500 }],
  },
  {
    name: "Azafrán en hebra (descatalogado)",
    baseUnit: "g",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [],
    active: false,
  },
  {
    name: "Guisantes congelados",
    baseUnit: "g",
    category: "frozen",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "bolsa", factor: 2500 },
      { unit: "caja", factor: 10000 },
    ],
  },
  {
    name: "Patatas fritas congeladas",
    baseUnit: "g",
    category: "frozen",
    storeroom: "Cámara frigorífica",
    conversions: [
      { unit: "bolsa", factor: 2500 },
      { unit: "caja", factor: 10000 },
    ],
  },
  {
    name: "Cerveza de barril",
    baseUnit: "ml",
    category: "drinks",
    storeroom: "Barra",
    conversions: [{ unit: "barril", factor: 30000 }],
  },
  {
    name: "Cerveza en botellín",
    baseUnit: "unit",
    category: "drinks",
    storeroom: "Barra",
    conversions: [{ unit: "caja", factor: 24000 }],
  },
  {
    name: "Agua mineral (botella 50 cl)",
    baseUnit: "unit",
    category: "drinks",
    storeroom: "Barra",
    conversions: [{ unit: "caja", factor: 24000 }],
  },
  {
    name: "Vino tinto Rioja crianza",
    baseUnit: "unit",
    category: "drinks",
    storeroom: "Barra",
    conversions: [{ unit: "caja", factor: 6000 }],
  },
  {
    name: "Refresco de cola (lata)",
    baseUnit: "unit",
    category: "drinks",
    storeroom: "Barra",
    conversions: [{ unit: "caja", factor: 24000 }],
  },
  {
    name: "Café en grano",
    baseUnit: "g",
    category: "drinks",
    storeroom: "Barra",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Lavavajillas industrial",
    baseUnit: "ml",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "garrafa", factor: 5000 }],
  },
  {
    name: "Bayetas",
    baseUnit: "unit",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "paquete", factor: 10000 }],
  },
  {
    name: "Papel de cocina (rollo)",
    baseUnit: "unit",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "paquete", factor: 6000 }],
  },
];

/** A seeded supplier product: its supplier by tax ID and its product by name. */
export interface SeedSupplierProduct {
  supplierTaxId: string;
  code: string;
  description: string;
  product: string;
  pack: { quantity: string; unit: string };
}

/** What each supplier sells. Tomatoes and lemons come from two suppliers, in different packs. */
export const seedSupplierProducts: SeedSupplierProduct[] = [
  {
    supplierTaxId: "B00100016",
    code: "TOM-CJ6",
    description: "Tomate pera, caja de 6 kg",
    product: "Tomate pera",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100016",
    code: "TOM-KG",
    description: "Tomate pera, kilo",
    product: "Tomate pera",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00100016",
    code: "CEB-S10",
    description: "Cebolla, saco de 10 kg",
    product: "Cebolla",
    pack: { quantity: "1", unit: "saco" },
  },
  {
    supplierTaxId: "B00100016",
    code: "PAT-S25",
    description: "Patata, saco de 25 kg",
    product: "Patata",
    pack: { quantity: "1", unit: "saco" },
  },
  {
    supplierTaxId: "B00100016",
    code: "PIM-CJ5",
    description: "Pimiento rojo, caja de 5 kg",
    product: "Pimiento rojo",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100016",
    code: "LEC-CJ12",
    description: "Lechuga romana, caja de 12",
    product: "Lechuga romana",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100016",
    code: "LIM-M2",
    description: "Limones, malla de 2 kg",
    product: "Limones",
    pack: { quantity: "1", unit: "malla" },
  },
  {
    supplierTaxId: "B00100016",
    code: "AJO-KG",
    description: "Ajo, kilo",
    product: "Ajo",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00100016",
    code: "PER-MJ",
    description: "Perejil, manojo",
    product: "Perejil (manojo)",
    pack: { quantity: "1", unit: "unit" },
  },
  {
    supplierTaxId: "B00100024",
    code: "POL-B25",
    description: "Pechuga de pollo, bandeja de 2,5 kg",
    product: "Pechuga de pollo",
    pack: { quantity: "1", unit: "bandeja" },
  },
  {
    supplierTaxId: "B00100024",
    code: "SOL-KG",
    description: "Solomillo de ternera, kilo",
    product: "Solomillo de ternera",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00100024",
    code: "LOM-P3",
    description: "Lomo de cerdo, pieza de 3 kg",
    product: "Lomo de cerdo",
    pack: { quantity: "1", unit: "pieza" },
  },
  {
    supplierTaxId: "B00100024",
    code: "JAM-100",
    description: "Jamón ibérico loncheado, sobre de 100 g",
    product: "Jamón ibérico loncheado",
    pack: { quantity: "1", unit: "sobre" },
  },
  {
    supplierTaxId: "B00100032",
    code: "MER-CJ5",
    description: "Merluza, caja de 5 kg",
    product: "Merluza",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100032",
    code: "GAM-CJ2",
    description: "Gambas, caja de 2 kg",
    product: "Gambas",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100032",
    code: "MEJ-M2",
    description: "Mejillones, malla de 2 kg",
    product: "Mejillones",
    pack: { quantity: "1", unit: "malla" },
  },
  {
    supplierTaxId: "B00100032",
    code: "BAC-KG",
    description: "Bacalao desalado, kilo",
    product: "Bacalao desalado",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00100040",
    code: "LEC-6",
    description: "Leche entera, caja de 6 l",
    product: "Leche entera",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100040",
    code: "NAT-12",
    description: "Nata para cocinar, caja de 12 briks",
    product: "Nata para cocinar",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100040",
    code: "MAN-250",
    description: "Mantequilla, bloque de 250 g",
    product: "Mantequilla",
    pack: { quantity: "1", unit: "bloque" },
  },
  {
    supplierTaxId: "B00100040",
    code: "QMA-KG",
    description: "Queso manchego, kilo",
    product: "Queso manchego",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00100040",
    code: "HUE-30",
    description: "Huevos camperos, bandeja de 30",
    product: "Huevos camperos",
    pack: { quantity: "1", unit: "bandeja" },
  },
  {
    supplierTaxId: "B00100040",
    code: "HUE-12",
    description: "Huevos camperos, docena",
    product: "Huevos camperos",
    pack: { quantity: "1", unit: "docena" },
  },
  {
    supplierTaxId: "B00100057",
    code: "PB-10",
    description: "Pan de barra, bolsa de 10",
    product: "Pan de barra",
    pack: { quantity: "1", unit: "bolsa" },
  },
  {
    supplierTaxId: "B00100057",
    code: "PM-1",
    description: "Pan de molde",
    product: "Pan de molde",
    pack: { quantity: "1", unit: "unit" },
  },
  {
    supplierTaxId: "B00100065",
    code: "ACE-5L",
    description: "Aceite de oliva virgen extra, garrafa de 5 l",
    product: "Aceite de oliva virgen extra",
    pack: { quantity: "1", unit: "garrafa" },
  },
  {
    supplierTaxId: "B00100065",
    code: "HAR-25",
    description: "Harina de trigo, saco de 25 kg",
    product: "Harina de trigo",
    pack: { quantity: "1", unit: "saco" },
  },
  {
    supplierTaxId: "B00100065",
    code: "ARR-5",
    description: "Arroz bomba, saco de 5 kg",
    product: "Arroz bomba",
    pack: { quantity: "1", unit: "saco" },
  },
  {
    supplierTaxId: "B00100065",
    code: "AZU-1",
    description: "Azúcar, kilo",
    product: "Azúcar",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00100065",
    code: "SAL-1",
    description: "Sal fina, kilo",
    product: "Sal fina",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00100065",
    code: "PIM-75",
    description: "Pimentón de la Vera, lata de 75 g",
    product: "Pimentón de la Vera",
    pack: { quantity: "1", unit: "lata" },
  },
  {
    supplierTaxId: "B00100065",
    code: "GAR-1",
    description: "Garbanzos, kilo",
    product: "Garbanzos",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00100065",
    code: "TT-12",
    description: "Tomate triturado, caja de 12 latas",
    product: "Tomate triturado",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100065",
    code: "VIN-50",
    description: "Vinagre de Jerez, botella de 50 cl",
    product: "Vinagre de Jerez",
    pack: { quantity: "1", unit: "botella" },
  },
  {
    supplierTaxId: "B00100065",
    code: "GUI-CJ",
    description: "Guisantes congelados, caja de 10 kg",
    product: "Guisantes congelados",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100065",
    code: "PF-25",
    description: "Patatas fritas congeladas, bolsa de 2,5 kg",
    product: "Patatas fritas congeladas",
    pack: { quantity: "1", unit: "bolsa" },
  },
  {
    supplierTaxId: "B00100065",
    code: "TOM-5",
    description: "Tomate pera, caja de 5 kg",
    product: "Tomate pera",
    pack: { quantity: "5", unit: "kg" },
  },
  {
    supplierTaxId: "B00100065",
    code: "AZA-1",
    description: "Azafrán en hebra, 1 g",
    product: "Azafrán en hebra (descatalogado)",
    pack: { quantity: "1", unit: "g" },
  },
  {
    supplierTaxId: "B00100073",
    code: "CB-30",
    description: "Cerveza, barril de 30 l",
    product: "Cerveza de barril",
    pack: { quantity: "1", unit: "barril" },
  },
  {
    supplierTaxId: "B00100073",
    code: "CBT-24",
    description: "Cerveza, caja de 24 botellines",
    product: "Cerveza en botellín",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100073",
    code: "AG-24",
    description: "Agua mineral 50 cl, caja de 24",
    product: "Agua mineral (botella 50 cl)",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100073",
    code: "RC-6",
    description: "Rioja crianza, caja de 6 botellas",
    product: "Vino tinto Rioja crianza",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100073",
    code: "COL-24",
    description: "Refresco de cola, caja de 24 latas",
    product: "Refresco de cola (lata)",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00100073",
    code: "CAF-1",
    description: "Café en grano, kilo",
    product: "Café en grano",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00100073",
    code: "LIM-KG",
    description: "Limones, kilo",
    product: "Limones",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00100081",
    code: "LV-5",
    description: "Lavavajillas industrial, garrafa de 5 l",
    product: "Lavavajillas industrial",
    pack: { quantity: "1", unit: "garrafa" },
  },
  {
    supplierTaxId: "B00100081",
    code: "BAY-10",
    description: "Bayetas, paquete de 10",
    product: "Bayetas",
    pack: { quantity: "1", unit: "paquete" },
  },
  {
    supplierTaxId: "B00100081",
    code: "PAP-6",
    description: "Papel de cocina, paquete de 6 rollos",
    product: "Papel de cocina (rollo)",
    pack: { quantity: "1", unit: "paquete" },
  },
];
