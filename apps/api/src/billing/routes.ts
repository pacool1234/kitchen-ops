import { endpoints, type FieldErrorCode } from "@kitchen-ops/shared";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { audited, auditContext, type AuditedChange } from "../audit/audited";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { invoiceLineBills } from "../db/schema";
import { currentDraft, documentInReview } from "../documents/review";
import { HttpError } from "../errors";
import { readMatching } from "../matching/matching";
import {
  billableLines,
  billedAlready,
  isCreditNote,
  storedChoices,
} from "./billing";

// Which delivery-note line each line of an invoice in review bills (#120, decision 0041): the
// lines it may bill, and confirming or changing each line's choice, by office and the owner.
// Each choice made, changed or undone is audited with the document.

/** The invoice in review, locked, with its draft as it stands and its supplier. */
async function invoiceInReview(
  tx: Parameters<typeof documentInReview>[0],
  id: string,
) {
  const document = await documentInReview(tx, id);
  const draft = currentDraft(document);
  if (draft?.documentType !== "invoice") {
    throw new HttpError(409, "not_an_invoice");
  }
  if (!document.supplierId) throw new HttpError(409, "no_supplier");
  return { draft, supplierId: document.supplierId };
}

/** A choice as the audit log records it: the line, and what it bills. */
const audit = (
  position: number,
  choice: { deliveryNoteLineId: string | null; received: boolean } | null,
) =>
  choice === null
    ? null
    : {
        position,
        deliveryNoteLineId: choice.deliveryNoteLineId,
        received: choice.received,
      };

export const billingRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  app.route({
    ...routeFor(endpoints.listBillingCandidates),
    handler: async ({ params }) =>
      // In a transaction only to read the invoice as a write does: nothing is written.
      db.transaction(async (tx) => {
        const { draft, supplierId } = await invoiceInReview(tx, params.id);
        const [billable, stored] = await Promise.all([
          billableLines(tx, supplierId, { credit: isCreditNote(draft) }),
          storedChoices(tx, params.id),
        ]);
        const chosenFor = new Map(
          stored.flatMap((c) =>
            c.deliveryNoteLineId ? [[c.deliveryNoteLineId, c.position]] : [],
          ),
        );
        return {
          lines: billable.map((b) => ({
            ...b.line,
            chosenFor: chosenFor.get(b.line.id) ?? null,
          })),
        };
      }),
  });

  app.route({
    ...routeFor(endpoints.setDocumentBilling),
    handler: async (request) => {
      const { id } = request.params;
      const entries = request.body.lines;
      await audited(db, auditContext(request), async (tx) => {
        const { draft, supplierId } = await invoiceInReview(tx, id);
        if (entries.length !== draft.lines.length) {
          throw new HttpError(400, "invalid_input", { lines: "invalid" });
        }
        const credit = isCreditNote(draft);
        const wanted = entries.flatMap((e) =>
          e !== null && "deliveryNoteLineId" in e ? [e.deliveryNoteLineId] : [],
        );
        const [billable, taken] = await Promise.all([
          billableLines(tx, supplierId, { credit }),
          // A credit note restates a line's price: it bills one an invoice billed already.
          credit ? new Set<string>() : billedAlready(tx, wanted),
        ]);
        const ids = new Set(billable.map((b) => b.line.id));

        const invalid: Record<string, FieldErrorCode> = {};
        const conflicts: Record<string, FieldErrorCode> = {};
        const seen = new Set<string>();
        entries.forEach((entry, i) => {
          if (entry === null || !("deliveryNoteLineId" in entry)) return;
          const lineId = entry.deliveryNoteLineId;
          if (seen.has(lineId) || taken.has(lineId)) {
            conflicts[`lines.${i}`] = "taken";
          } else if (!ids.has(lineId)) {
            invalid[`lines.${i}`] = "not_found";
          }
          seen.add(lineId);
        });
        if (Object.keys(invalid).length > 0) {
          throw new HttpError(400, "invalid_input", invalid);
        }
        if (Object.keys(conflicts).length > 0) {
          throw new HttpError(409, "conflict", conflicts);
        }

        const stored = new Map(
          (await storedChoices(tx, id)).map((c) => [c.position, c]),
        );
        const changes: AuditedChange[] = [];
        const change = (
          action: AuditedChange["action"],
          entityId: string,
          before: Record<string, unknown> | null,
          after: Record<string, unknown> | null,
        ) =>
          changes.push({
            action,
            entityType: "invoice_line_bill",
            entityId,
            documentId: id,
            before,
            after,
          });
        for (const [i, entry] of entries.entries()) {
          const position = i + 1;
          const before = stored.get(position);
          stored.delete(position);
          const after =
            entry === null
              ? null
              : "received" in entry
                ? { deliveryNoteLineId: null, received: true }
                : {
                    deliveryNoteLineId: entry.deliveryNoteLineId,
                    received: false,
                  };
          if (before === undefined && after === null) continue;
          if (before === undefined) {
            const [row] = await tx
              .insert(invoiceLineBills)
              .values({ documentId: id, position, ...after! })
              .returning({ id: invoiceLineBills.id });
            change("create", row!.id, null, audit(position, after));
          } else if (after === null) {
            await tx
              .delete(invoiceLineBills)
              .where(eq(invoiceLineBills.id, before.id));
            change("delete", before.id, audit(position, before), null);
          } else {
            await tx
              .update(invoiceLineBills)
              .set(after)
              .where(eq(invoiceLineBills.id, before.id));
            change(
              "update",
              before.id,
              audit(position, before),
              audit(position, after),
            );
          }
        }
        // Choices for lines past the draft's end: none, since a correction that adds or removes
        // lines clears them, but never kept.
        for (const left of stored.values()) {
          await tx
            .delete(invoiceLineBills)
            .where(eq(invoiceLineBills.id, left.id));
          change("delete", left.id, audit(left.position, left), null);
        }
        return { result: undefined, changes };
      });
      return (await readMatching(db, id))!;
    },
  });
};
