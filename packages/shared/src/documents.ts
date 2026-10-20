import { z } from "zod";
import type { Role } from "./auth";
import { EXTRACTED_DOCUMENT_TYPES, ExtractedDocument } from "./extraction";
import { PageQuery, pageOf } from "./lists";

// Supplier documents (spec section 3, #102): a delivery note or an invoice, as one PDF or Facturae
// file, or as one or several photos. Each file is kept in object storage (decision 0029).

/**
 * Where a document is on its way to review and into stock (#104 moves it along; M7 reviews and
 * posts it). A posted document never changes again (invariant 7, decision 0034).
 */
export const DOCUMENT_STATUSES = [
  "queued",
  "reading",
  "ready_for_review",
  "failed",
  "posted",
] as const;
export const DocumentStatus = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

/** A delivery note or an invoice, once read: the extraction's own values. */
export const DocumentType = z.enum(EXTRACTED_DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentType>;

/** What a file is: one PDF or Facturae XML makes a document, or up to 10 photos do. */
export const FILE_KINDS = ["pdf", "xml", "image"] as const;
export const FileKind = z.enum(FILE_KINDS);
export type FileKind = z.infer<typeof FileKind>;

/** What an upload may hold. 20 MB a file is the most extraction reads (packages/extract). */
export const UPLOAD_LIMITS = {
  maxPhotos: 10,
  maxFileBytes: 20 * 1024 * 1024,
  /** The whole request: what a phone's photos come to, with room to spare. */
  maxRequestBytes: 60 * 1024 * 1024,
  /** The form field the files are sent in. */
  field: "files",
} as const;

/**
 * Why reading a document failed (#104), as a code the web app has a message for. Never the
 * document's contents or a provider's own words.
 */
export const EXTRACTION_FAILURES = [
  /** The model service answered with an error, every try. */
  "model_error",
  /** The model service couldn't be reached, every try. */
  "model_unreachable",
  /** The document's files couldn't be fetched from storage, every try. */
  "storage_error",
  /** The files can't be read: a broken photo, a PDF with too many pages… Not tried again. */
  "unreadable",
  /** Reading stopped before it finished, every try: the server restarted or took too long. */
  "interrupted",
  /** Anything else, every try. */
  "unexpected",
] as const;
export const ExtractionFailure = z.enum(EXTRACTION_FAILURES);
export type ExtractionFailure = z.infer<typeof ExtractionFailure>;

/**
 * The checks a read document is put through (spec section 5, stage 4; packages/extract runs
 * them). Here so the web app can name them in words (#106).
 */
export const CHECK_NAMES = [
  "missing-value",
  "line-total",
  "lines-sum",
  "vat",
  "total",
  "tax-id",
  "date",
  "duplicate",
] as const;
export const CheckName = z.enum(CHECK_NAMES);
export type CheckName = z.infer<typeof CheckName>;

/**
 * A check the draft failed, and the field it failed on ("lines.0.lineTotal"). Never the check's
 * own message: it's for logs, in English, and may quote the document.
 */
export const DocumentCheckFailure = z.strictObject({
  check: CheckName,
  path: z.string(),
});
export type DocumentCheckFailure = z.infer<typeof DocumentCheckFailure>;

/** Who is shown what reading a document cost: costs are the owner's (spec section 6). */
export function seesReadingCost(role: Role): boolean {
  return role === "owner";
}

export const DocumentSummary = z.object({
  id: z.uuid(),
  status: DocumentStatus,
  /** Why it's `failed`; null in any other status. */
  failureReason: ExtractionFailure.nullable(),
  type: DocumentType.nullable(),
  supplier: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  number: z.string().nullable(),
  /** The issue date as printed, YYYY-MM-DD, once read. */
  date: z.iso.date().nullable(),
  fileCount: z.number().int().min(1),
  uploadedBy: z.object({ id: z.uuid(), name: z.string() }),
  uploadedAt: z.iso.datetime({ offset: true }),
  /**
   * The document that reverses it, and the day it was reversed (#119, decision 0034): a posted
   * document is never changed, so "reversed" is another document. Null for one that stands.
   */
  reversal: z.object({ id: z.uuid(), date: z.iso.date() }).nullable(),
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

export const DocumentFile = z.object({
  id: z.uuid(),
  /** From 1, in the order the files were sent: page 1, page 2… */
  position: z.number().int().min(1),
  kind: FileKind,
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** A short-lived link to the file itself, made for each read. */
  url: z.url(),
  urlExpiresAt: z.iso.datetime({ offset: true }),
});
export type DocumentFile = z.infer<typeof DocumentFile>;

export const Document = DocumentSummary.extend({
  files: z.array(DocumentFile),
  /** What the model read, once it has; null before, or when its answer didn't fit the schema. */
  draft: ExtractedDocument.nullable(),
  /**
   * The draft as corrected in review (#118, decision 0037), whole: null until a correction is
   * saved. `draft` stays what the model read, so both can be seen.
   */
  corrected: ExtractedDocument.nullable(),
  /**
   * The checks the draft failed, the corrected one if there is one: empty when it passed them
   * all, or nothing has been read.
   */
  checkFailures: z.array(DocumentCheckFailure),
  /**
   * What reading it has cost so far, every try included, and asking a model for its lines'
   * products (decision 0036), in millionths of a US dollar: a whole
   * number, never a fraction of a dollar. A call whose cost OpenRouter didn't report adds 0.
   * Only in the owner's answers (`seesReadingCost`).
   */
  costMicroUsd: z.number().int().nonnegative().optional(),
  /** The reversed document this one is a corrected copy of, to review and post again (#119). */
  copyOf: z.uuid().nullable(),
  /** Its corrected copy, once the owner has made one of it, reversed. */
  copy: z.uuid().nullable(),
});
export type Document = z.infer<typeof Document>;

/** Answer of `POST /api/documents/:id/draft/checks`: the checks a version would fail. */
export const DraftChecks = z.object({
  checkFailures: z.array(DocumentCheckFailure),
});
export type DraftChecks = z.infer<typeof DraftChecks>;

/** Answer of `PUT /api/documents/:id/draft`: the correction saved, and the checks it failed. */
export const SavedDraft = DraftChecks.extend({ corrected: ExtractedDocument });
export type SavedDraft = z.infer<typeof SavedDraft>;

/** Query of `GET /api/documents`: newest first. */
export const DocumentQuery = PageQuery.extend({
  status: DocumentStatus.optional(),
});
export type DocumentQuery = z.infer<typeof DocumentQuery>;

export const DocumentPage = pageOf(DocumentSummary);
export type DocumentPage = z.infer<typeof DocumentPage>;
