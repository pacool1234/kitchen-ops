import type { ExtractedDocument } from "@kitchen-ops/shared";
import type { Db } from "../db/client";
import { documents } from "../db/schema";
import { fakeDocument } from "../extraction/fake";

// Matching in tests (#117): documents as the reading job leaves them, with the lines wanted,
// and posted documents to make a supplier established.

/** A draft whose lines have these codes and descriptions; the rest is the fake model's. */
export function draftWith(
  lines: readonly {
    supplierCode: string | null;
    description: string | null;
  }[],
): ExtractedDocument {
  const read = fakeDocument("2026-10-20");
  return {
    ...read,
    lines: lines.map((line) => ({ ...read.lines[0]!, ...line })),
  };
}

/** A document ready for review, as the reading job leaves it. */
export async function documentRead(
  db: Db,
  values: {
    uploadedBy: string;
    supplierId?: string | null;
    draft?: ExtractedDocument | null;
    failedChecks?: boolean;
    status?: "ready_for_review" | "queued" | "failed";
  },
): Promise<string> {
  const [row] = await db
    .insert(documents)
    .values({
      status: values.status ?? "ready_for_review",
      failureReason: values.status === "failed" ? "unreadable" : null,
      uploadedBy: values.uploadedBy,
      supplierId: values.supplierId ?? null,
      draft: values.draft ?? null,
      checkFailures: values.failedChecks
        ? [{ check: "line-total", path: "lines.0.lineTotal", message: "" }]
        : [],
    })
    .returning({ id: documents.id });
  return row!.id;
}

/**
 * A posted delivery note from this supplier, with this number if given, and, if asked, its
 * reversal. Returns its ID.
 */
export async function postedFrom(
  db: Db,
  uploadedBy: string,
  supplierId: string,
  { reversed = false, number = null as string | null } = {},
): Promise<string> {
  const posted = {
    status: "posted" as const,
    type: "delivery-note" as const,
    supplierId,
    number,
    date: "2026-10-20",
    uploadedBy,
  };
  const [row] = await db
    .insert(documents)
    .values(posted)
    .returning({ id: documents.id });
  if (reversed) {
    await db.insert(documents).values({ ...posted, reverses: row!.id });
  }
  return row!.id;
}
