import { endpoints } from "@kitchen-ops/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { auditContext } from "../audit/audited";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { HttpError, notFound } from "../errors";
import { today } from "../extraction/read";
import { readPosting } from "../posting/read";
import { recordStockDocument, type RecordResult } from "./record";
import { productStock } from "./stock";

// A product's stock and average cost in each storeroom (#120), for office and the owner. Waste
// and transfers, recorded by anyone under an ID their client made, and posted at once (#149).

/** A refusal from recording, as the API answers it. */
function refusal(result: Exclude<RecordResult, { ok: true }>): HttpError {
  switch (result.reason) {
    case "conflict":
      return new HttpError(409, "conflict");
    case "invalid":
      return new HttpError(400, "invalid_input", { ...result.fields });
    case "below_zero":
      return new HttpError(409, "cannot_post", { ...result.fields });
  }
}

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

  app.route({
    ...routeFor(endpoints.recordWaste),
    handler: async (request) => {
      const { id } = request.params;
      const result = await recordStockDocument(
        db,
        auditContext(request),
        id,
        { type: "waste", ...request.body },
        { date: today(new Date()) },
      );
      if (!result.ok) throw refusal(result);
      return (await readPosting(db, id))!;
    },
  });

  app.route({
    ...routeFor(endpoints.recordTransfer),
    handler: async (request) => {
      const { id } = request.params;
      const result = await recordStockDocument(
        db,
        auditContext(request),
        id,
        { type: "transfer", ...request.body },
        { date: today(new Date()) },
      );
      if (!result.ok) throw refusal(result);
      return (await readPosting(db, id))!;
    },
  });
};
