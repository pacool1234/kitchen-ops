import {
  MAX_AGE_DAYS,
  validate,
  type CheckFailure,
} from "@kitchen-ops/extract";
import {
  normalizeTaxId,
  type DocumentCheckFailure,
  type ExtractedDocument,
} from "@kitchen-ops/shared";
import { and, eq, isNotNull, isNull, ne, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "../audit/audited";
import type { Db } from "../db/client";
import { documents, suppliers } from "../db/schema";

// The checks a draft is put through (spec section 5, stage 4), with what they need from the
// database: the numbers already received from the document's supplier. Run when a document is
// read (#104), and again when it's corrected or its supplier is chosen in review (#118), so the
// failures stored are always those of the draft as it stands. A reversed document, and its
// reversal, no longer count as received (#119): a corrected copy has the same number.

type Reader = Db | Tx;

/** Our supplier with this tax ID, as read: its ID, or null if there's none. */
export async function supplierByTaxId(
  db: Reader,
  taxId: string | null,
): Promise<string | null> {
  if (!taxId) return null;
  const [supplier] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.taxId, normalizeTaxId(taxId)));
  return supplier?.id ?? null;
}

const reversal = alias(documents, "reversal");

/** The checks `draft` fails as document `documentId`, from `supplierId`, on `today` (YYYY-MM-DD). */
export async function checksOf(
  db: Reader,
  {
    documentId,
    supplierId,
    draft,
    today,
  }: {
    documentId: string;
    supplierId: string | null;
    draft: ExtractedDocument;
    today: string;
  },
): Promise<readonly CheckFailure[]> {
  const known = supplierId
    ? await db
        .select({ number: documents.number })
        .from(documents)
        .where(
          and(
            eq(documents.supplierId, supplierId),
            ne(documents.id, documentId),
            isNotNull(documents.number),
            isNull(documents.reverses),
            notExists(
              db
                .select({ id: reversal.id })
                .from(reversal)
                .where(eq(reversal.reverses, documents.id)),
            ),
          ),
        )
    : [];
  return validate(draft, {
    today,
    maxAgeDays: MAX_AGE_DAYS,
    knownNumbers: known.map((k) => k.number!),
  }).failures;
}

/** Failures as the API answers them: each check's message stays in the database, as it may quote the document. */
export const withoutMessages = (
  failures: readonly CheckFailure[],
): DocumentCheckFailure[] =>
  failures.map(({ check, path }) => ({ check, path }));
