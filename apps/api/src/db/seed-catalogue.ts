import type { storerooms, suppliers } from "./schema";

// The fictional restaurant's catalogue (#88, spec 11.1), for local development, CI and the demo.
// Synthetic: the suppliers are made up, their emails are on the reserved .example domain, and
// their CIFs are in province 00, which doesn't exist, so they belong to no real company.

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
