import { UPLOAD_LIMITS } from "@kitchen-ops/shared";
import { describe, expect, it } from "vitest";
import { sample } from "../test/documents";
import { checkUpload } from "./upload";

// Whether an upload can become a document (#102), before anything is stored: one PDF or Facturae
// file, or up to 10 photos, each recognised by its bytes and within the size limit.

const files = (...bytes: Uint8Array[]) => bytes.map((b) => ({ bytes: b }));

describe("checkUpload", () => {
  it("one PDF, one XML, or several photos: each file's kind and content type, in order", () => {
    expect(checkUpload(files(sample.pdf(1)))).toEqual({
      ok: true,
      files: [
        { kind: "pdf", contentType: "application/pdf", extension: "pdf" },
      ],
    });
    expect(checkUpload(files(sample.xml(1)))).toEqual({
      ok: true,
      files: [
        { kind: "xml", contentType: "application/xml", extension: "xml" },
      ],
    });
    expect(checkUpload(files(sample.png(1), sample.jpeg(2)))).toEqual({
      ok: true,
      files: [
        { kind: "image", contentType: "image/png", extension: "png" },
        { kind: "image", contentType: "image/jpeg", extension: "jpg" },
      ],
    });
  });

  it("exactly the limit of photos is fine; one more is too many", () => {
    const photos = (n: number) =>
      files(...Array.from({ length: n }, (_, i) => sample.jpeg(i)));
    expect(checkUpload(photos(UPLOAD_LIMITS.maxPhotos)).ok).toBe(true);
    expect(checkUpload(photos(UPLOAD_LIMITS.maxPhotos + 1))).toEqual({
      ok: false,
      fields: { files: "too_many" },
    });
  });

  it("exactly the size limit is fine; one byte more is too big, named by its position", () => {
    expect(
      checkUpload(files(sample.pdfOfSize(UPLOAD_LIMITS.maxFileBytes))).ok,
    ).toBe(true);
    expect(
      checkUpload(
        files(sample.jpeg(1), sample.pdfOfSize(UPLOAD_LIMITS.maxFileBytes + 1)),
      ),
    ).toEqual({ ok: false, fields: { "files.2": "too_big" } });
  });

  it.each([
    ["nothing", files(), { files: "required" }],
    [
      "a PDF with a photo",
      files(sample.pdf(1), sample.jpeg(2)),
      { files: "mixed_kinds" },
    ],
    [
      "an XML with a photo",
      files(sample.jpeg(1), sample.xml(2)),
      { files: "mixed_kinds" },
    ],
    ["two PDFs", files(sample.pdf(1), sample.pdf(2)), { files: "mixed_kinds" }],
    ["text", files(sample.plainText(1)), { "files.1": "unsupported_type" }],
    [
      "a HEIC photo among JPEGs",
      files(sample.jpeg(1), sample.heic(2)),
      { "files.2": "unsupported_type" },
    ],
  ])("refuses %s", (_, upload, fields) => {
    expect(checkUpload(upload)).toEqual({ ok: false, fields });
  });
});
