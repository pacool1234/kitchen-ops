import { endpoints } from "@kitchen-ops/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { listActiveProducts } from "./queries";

/** Products. Any signed-in role may list them (spec section 6: everyone counts stock). */
export const productRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  app.route({
    ...routeFor(endpoints.listProducts),
    handler: async () => ({ products: await listActiveProducts(db) }),
  });
};
