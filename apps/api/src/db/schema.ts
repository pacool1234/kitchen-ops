import { BASE_UNITS } from "@kitchen-ops/shared";
import { boolean, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, primaryId } from "./columns";

export * from "./auth-schema";

// Change this file, then run `pnpm --filter @kitchen-ops/api db:generate` to write the migration.

/** The unit a product's stock is counted in (spec section 3); values come from packages/shared. */
export const baseUnit = pgEnum("base_unit", BASE_UNITS);

export const products = pgTable("products", {
  id: primaryId(),
  name: text("name").notNull(),
  baseUnit: baseUnit("base_unit").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});
