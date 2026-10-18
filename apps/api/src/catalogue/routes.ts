import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Db } from "../db/client";
import { productRoutes } from "./products";
import { storeroomRoutes } from "./storerooms";
import { supplierProductRoutes } from "./supplier-products";
import { supplierRoutes } from "./suppliers";

/** The catalogue (#88): storerooms, suppliers, products and supplier products. */
export const catalogueRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  await app.register(storeroomRoutes, { db });
  await app.register(supplierRoutes, { db });
  await app.register(productRoutes, { db });
  await app.register(supplierProductRoutes, { db });
};
