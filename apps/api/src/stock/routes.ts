import { endpoints, seesCosts } from "@kitchen-ops/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { auditContext } from "../audit/audited";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { HttpError, notFound } from "../errors";
import { today } from "../extraction/read";
import { readStockDocument } from "./document";
import { stockList } from "./list";
import { productMovements } from "./movements";
import { recordStockDocument, type RecordResult } from "./record";
import { productStock } from "./stock";

// A product's stock and average cost in each storeroom (#120), for office and the owner. The
// stock list and a product's movements, for everyone, with euros for office and the owner only
// (#150). Waste, transfers and counts, recorded by anyone under an ID their client made, and
// posted at once (#149), each read on its own page (#151).

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
    ...routeFor(endpoints.listStock),
    handler: async ({ query, user }) =>
      stockList(db, query, { costs: seesCosts(user!.role) }),
  });

  app.route({
    ...routeFor(endpoints.listProductMovements),
    handler: async ({ params, query, user }) => {
      const page = await productMovements(db, params.id, query, {
        costs: seesCosts(user!.role),
      });
      if (!page) throw notFound();
      return page;
    },
  });

  app.route({
    ...routeFor(endpoints.getStockDocument),
    handler: async ({ params, user }) => {
      const document = await readStockDocument(db, params.id, {
        costs: seesCosts(user!.role),
      });
      if (!document) throw notFound();
      return document;
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
      return (await readStockDocument(db, id, {
        costs: seesCosts(request.user!.role),
      }))!;
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
      return (await readStockDocument(db, id, {
        costs: seesCosts(request.user!.role),
      }))!;
    },
  });

  app.route({
    ...routeFor(endpoints.recordCount),
    handler: async (request) => {
      const { id } = request.params;
      const result = await recordStockDocument(
        db,
        auditContext(request),
        id,
        { type: "count", ...request.body },
        // Dated the day it was counted, which a count synced late isn't today.
        { date: today(new Date(request.body.countedAt)) },
      );
      if (!result.ok) throw refusal(result);
      return (await readStockDocument(db, id, {
        costs: seesCosts(request.user!.role),
      }))!;
    },
  });
};
