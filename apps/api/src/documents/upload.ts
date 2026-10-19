import { detectFormat } from "@kitchen-ops/extract";
import {
  UPLOAD_LIMITS,
  type FieldErrorCode,
  type FileKind,
} from "@kitchen-ops/shared";

// Whether an upload can become a document (#102), before anything is stored. Each file is known
// by its first bytes (packages/extract's detectFormat), never by its name or what the browser
// says it is. A PDF or Facturae XML makes a document on its own; photos may be several.

export interface CheckedFile {
  kind: FileKind;
  contentType: string;
  /** For its storage key: documents/<id>/<position>.<extension>. */
  extension: string;
}

export type UploadCheck =
  | { ok: true; files: CheckedFile[] }
  | { ok: false; fields: Record<string, FieldErrorCode> };

const ACCEPTED: Partial<Record<ReturnType<typeof detectFormat>, CheckedFile>> =
  {
    pdf: { kind: "pdf", contentType: "application/pdf", extension: "pdf" },
    xml: { kind: "xml", contentType: "application/xml", extension: "xml" },
    jpeg: { kind: "image", contentType: "image/jpeg", extension: "jpg" },
    png: { kind: "image", contentType: "image/png", extension: "png" },
  };

/** Each file's kind, or what's wrong, by field: `files` for the whole, `files.2` for the second. */
export function checkUpload(
  files: readonly { bytes: Uint8Array }[],
): UploadCheck {
  if (files.length === 0) return { ok: false, fields: { files: "required" } };
  if (files.length > UPLOAD_LIMITS.maxPhotos) {
    return { ok: false, fields: { files: "too_many" } };
  }

  const fields: Record<string, FieldErrorCode> = {};
  const checked: CheckedFile[] = [];
  files.forEach(({ bytes }, i) => {
    const field = `files.${i + 1}`;
    const accepted = ACCEPTED[detectFormat(bytes)];
    if (bytes.length > UPLOAD_LIMITS.maxFileBytes) fields[field] = "too_big";
    else if (!accepted) fields[field] = "unsupported_type";
    else checked.push(accepted);
  });
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  // A PDF or an XML is the whole document: never with photos, never two of them.
  if (checked.length > 1 && checked.some((f) => f.kind !== "image")) {
    return { ok: false, fields: { files: "mixed_kinds" } };
  }
  return { ok: true, files: checked };
}
