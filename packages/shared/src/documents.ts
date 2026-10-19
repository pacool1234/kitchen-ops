import { z } from "zod";
import { EXTRACTED_DOCUMENT_TYPES } from "./extraction";
import { PageQuery, pageOf } from "./lists";

// Supplier documents (spec section 3, #102): a delivery note or an invoice, as one PDF or Facturae
// file, or as one or several photos. Each file is kept in object storage (decision 0029).

/** Where a document is on its way to review (#104 moves it along; M7 reviews it). */
export const DOCUMENT_STATUSES = [
  "queued",
  "reading",
  "ready_for_review",
  "failed",
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
  /**
   * What reading it has cost so far, every try included, in millionths of a US dollar: a whole
   * number, never a fraction of a dollar. A call whose cost OpenRouter didn't report adds 0.
   */
  costMicroUsd: z.number().int().nonnegative(),
});
export type Document = z.infer<typeof Document>;

/** Query of `GET /api/documents`: newest first. */
export const DocumentQuery = PageQuery.extend({
  status: DocumentStatus.optional(),
});
export type DocumentQuery = z.infer<typeof DocumentQuery>;

export const DocumentPage = pageOf(DocumentSummary);
export type DocumentPage = z.infer<typeof DocumentPage>;
