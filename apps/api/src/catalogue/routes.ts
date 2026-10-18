import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Db } from "../db/client";
import { storeroomRoutes } from "./storerooms";
import { supplierRoutes } from "./suppliers";

/** The catalogue (#88): storerooms and suppliers. */
export const catalogueRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  await app.register(storeroomRoutes, { db });
  await app.register(supplierRoutes, { db });
};
