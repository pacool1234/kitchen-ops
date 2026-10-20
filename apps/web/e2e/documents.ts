import { crc32, deflateSync } from "node:zlib";
import { expect, type Page } from "@playwright/test";
import { mainNav } from "./shell.ts";

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

/** One PNG chunk: its length, type, data and CRC (the PNG specification, section 5.3). */
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A real photo, a grey 40 × 30 PNG that extraction can decode, made a file of its own by `label`
 * in a text chunk, which a viewer ignores.
 */
export function photoPng(label: string): Buffer {
  const [width, height] = [40, 30];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits a channel, RGB, no interlacing
  // Each row: filter type 0, then each pixel's red, green and blue.
  const row = Buffer.alloc(1 + 3 * width, 0x80);
  row[0] = 0;
  const rows = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("tEXt", Buffer.from(`Comment\0${label}`, "latin1")),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Opens the documents list from the main navigation. */
export async function openDocuments(page: Page): Promise<void> {
  await mainNav(page).getByRole("link", { name: "Documentos" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Documentos",
  );
}

/** A document's status, as its page shows it. */
export const statusOf = (page: Page) => page.getByTestId("document-status");

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
