import {
  suggestProducts,
  type SuggestionLine,
  type SuggestionResult,
} from "@kitchen-ops/extract";
import type { ExtractedDocument } from "@kitchen-ops/shared";
import { asc, eq } from "drizzle-orm";
import type { Tx } from "../audit/audited";
import { spanishOrder } from "../catalogue/lists";
import type { Db } from "../db/client";
import { lineSuggestions, products, suggestionCalls } from "../db/schema";
import { lineKey, matchLine } from "../matching/match";
import { offersOf } from "../matching/matching";
import type { Reader } from "./reader";

// After a document is read, a model suggests which of our products each line nothing matches is
// (#117, decision 0036): asked once, about each such line once, with our active products. The
// call's answer and cost are stored with the reading's try. A call that fails leaves those lines
// without a suggestion; it never fails the reading.

export interface Suggested {
  readonly lines: readonly SuggestionLine[];
  readonly result: SuggestionResult;
}

/** The lines nothing matches, each once, as a suggestion is asked for them. */
async function unmatchedLines(
  db: Db,
  supplierId: string | null,
  draft: ExtractedDocument,
): Promise<SuggestionLine[]> {
  const offers = supplierId ? await offersOf(db, supplierId) : [];
  const seen = new Set<string>();
  return draft.lines
    .filter((line) => matchLine(line, offers) === null)
    .filter((line) => {
      const key = lineKey(line);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ supplierCode, description, unit }) => ({
      supplierCode,
      description,
      unit,
    }));
}

/** Asks the model about the document's unmatched lines; null if there's nothing to ask. */
export async function suggestionsFor(
  db: Db,
  reader: Reader,
  supplierId: string | null,
  draft: ExtractedDocument,
): Promise<Suggested | null> {
  const lines = await unmatchedLines(db, supplierId, draft);
  if (lines.length === 0) return null;
  const catalogue = await db
    .select({
      id: products.id,
      name: products.name,
      baseUnit: products.baseUnit,
      category: products.category,
    })
    .from(products)
    .where(eq(products.active, true))
    .orderBy(spanishOrder(products.name), asc(products.id));
  if (catalogue.length === 0) return null;
  const result = await suggestProducts(reader.client, {
    ...reader.suggestion,
    lines,
    products: catalogue,
  });
  return { lines, result };
}

/** Stores the call, and each line's answer if it answered, in the reading's transaction. */
export async function storeSuggestions(
  tx: Tx,
  documentId: string,
  { lines, result }: Suggested,
) {
  const { record } = result;
  const [call] = await tx
    .insert(suggestionCalls)
    .values({
      documentId,
      outcome: result.status,
      model: record.model,
      promptVersion: record.promptVersion,
      modelCalls: record.attempts,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      costMicroUsd: record.costMicroUsd,
      latencyMs: record.latencyMs,
    })
    .returning({ id: suggestionCalls.id });
  if (result.status === "suggested") {
    await tx.insert(lineSuggestions).values(
      lines.map((line, i) => ({
        callId: call!.id,
        supplierCode: line.supplierCode,
        description: line.description,
        productId: result.productIds[i] ?? null,
      })),
    );
  }
}
