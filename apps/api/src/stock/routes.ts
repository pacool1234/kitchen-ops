import { endpoints } from "@kitchen-ops/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { notFound } from "../errors";
import { productStock } from "./stock";

// A product's stock and average cost in each storeroom (#120), for office and the owner.
export const stockRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  app.route({
    ...routeFor(endpoints.getProductStock),
    handler: async ({ params }) => {
      const stock = await productStock(db, params.id);
      if (!stock) throw notFound();
      return stock;
    },
  });
};
