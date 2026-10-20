import { expect, type Page } from "@playwright/test";

// Receiving documents (#106). The browser tests' API keeps files in the local S3 server and reads
// them with the fake model (start-api.ts), which answers a fixed delivery note, or fails every
// time when the document's text says FAIL. The desktop and phone runs share one database, and
// a file already received is refused, so every test's files are its own.

/** Text in a document that makes the fake model fail (the API's src/extraction/fake.ts). */
export const FAIL = "fake-model:fail";

/**
 * A one-page PDF whose text layer says `text`, written out by hand: the fake model is sent the
 * text of a PDF that has one, and never a photo's pixels. At least 20 characters, or extraction
 * treats it as a scan.
 */
export function textPdf(text: string): Buffer {
  const escaped = text.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = Buffer.byteLength(pdf, "latin1");
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

interface DocumentAnswer {
  id: string;
  status: string;
  failureReason: string | null;
  draft: { number: string | null } | null;
  checkFailures: unknown[];
  costMicroUsd?: number;
  files: { url: string }[];
}

/** Uploads one PDF through the web app's /api, as the signed-in user. */
export async function uploadPdf(
  page: Page,
  pdf: Buffer,
): Promise<DocumentAnswer> {
  const response = await page.request.post("/api/documents", {
    multipart: {
      files: { name: "albaran.pdf", mimeType: "application/pdf", buffer: pdf },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as DocumentAnswer;
}

/** Waits until the document is read or has failed, and answers it. */
export async function settled(page: Page, id: string): Promise<DocumentAnswer> {
  let document: DocumentAnswer | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/documents/${id}`);
        document = (await response.json()) as DocumentAnswer;
        return document.status;
      },
      { timeout: 30_000 },
    )
    .toMatch(/^(ready_for_review|failed)$/);
  return document!;
}
