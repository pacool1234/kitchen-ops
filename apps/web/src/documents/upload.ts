import {
  UPLOAD_LIMITS,
  type FieldErrorCode,
  type FileKind,
} from "@kitchen-ops/shared";

// The files chosen to upload, checked before anything is sent (#106): the API's rules and field
// codes (apps/api/src/documents/upload.ts), so a problem shows at once, by the same message.
// The browser only knows what a file says it is and its name; the API decides by its bytes.

/** What the upload page knows about a chosen file. */
export interface ChosenFile {
  readonly name: string;
  /** What the browser says it is: "image/jpeg"; often "" for a Facturae file. */
  readonly type: string;
  readonly size: number;
}

const BY_TYPE: Record<string, FileKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "application/pdf": "pdf",
  "application/xml": "xml",
  "text/xml": "xml",
};

const BY_EXTENSION: Record<string, FileKind> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  pdf: "pdf",
  xml: "xml",
  // A signed Facturae file.
  xsig: "xml",
};

/** A file's kind by its type, or else its name; null for anything the API won't take, HEIC included. */
export function kindOf(file: ChosenFile): FileKind | null {
  const byType = BY_TYPE[file.type];
  if (byType) return byType;
  if (file.type.startsWith("image/")) return null;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? null;
}

/** The problems with what's chosen, by field: `files` for the whole, `files.2` for the second. */
export function checkChosen(
  files: readonly ChosenFile[],
): Record<string, FieldErrorCode> {
  if (files.length === 0) return { files: "required" };
  if (files.length > UPLOAD_LIMITS.maxPhotos) return { files: "too_many" };

  const fields: Record<string, FieldErrorCode> = {};
  files.forEach((file, i) => {
    const field = `files.${i + 1}`;
    if (file.size > UPLOAD_LIMITS.maxFileBytes) fields[field] = "too_big";
    else if (!kindOf(file)) fields[field] = "unsupported_type";
  });
  if (Object.keys(fields).length > 0) return fields;

  // A PDF or an XML is the whole document: never with photos, never two of them.
  if (files.length > 1 && files.some((f) => kindOf(f) !== "image")) {
    return { files: "mixed_kinds" };
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > UPLOAD_LIMITS.maxRequestBytes) return { files: "too_big" };
  return {};
}
