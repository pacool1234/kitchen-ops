import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { loadImage } from "@napi-rs/canvas";
import { ExtractedDocument } from "@kitchen-ops/shared";
import { GOLD_DIRECTORY, goldIds, readGoldEntry } from "../gold/gold-set";
import { GoldMeta } from "../gold/meta";
import { formatDecimal } from "../gold/render";
import {
  hasTextLayer,
  MAX_RENDER_LONG_SIDE,
  pdfPageCount,
  pdfPageTexts,
  renderPdfPages,
} from "./pdf";

/** The gold text PDFs, with their answers. */
const goldTextPdfs = goldIds(GOLD_DIRECTORY).flatMap((id) => {
  const entry = readGoldEntry(GOLD_DIRECTORY, id);
  const meta = GoldMeta.safeParse(entry.meta);
  if (!meta.success || meta.data.kind !== "text-pdf") return [];
  return [
    {
      id,
      expected: ExtractedDocument.parse(entry.expected),
      pdf: new Uint8Array(
        readFileSync(new URL(`${id}/source.pdf`, GOLD_DIRECTORY)),
      ),
    },
  ];
});

/** A PDF whose pages are only images, as a scanner saves them. */
async function imageOnlyPdf(pages: readonly Uint8Array[]): Promise<Uint8Array> {
  const document = new PDFDocument({ autoFirstPage: false, margin: 0 });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise((resolve) => document.on("end", resolve));
  for (const page of pages) {
    document.addPage({ size: "A4", margin: 0 });
    document.image(Buffer.from(page), 0, 0, { fit: [595.28, 841.89] });
  }
  document.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}

describe("pdfPageTexts: a text PDF's text, page by page, with table rows kept on one line", () => {
  it("there are gold text PDFs to test with, including one of two pages", () => {
    expect(goldTextPdfs.length).toBeGreaterThan(0);
    expect(goldTextPdfs.map(({ id }) => id)).toContain(
      "syn-003-invoice-multi-page",
    );
  });

  it("for every gold text PDF, each product line's description and printed total appear on the same line, in the printed order", async () => {
    for (const { id, expected, pdf } of goldTextPdfs) {
      const lines = (await pdfPageTexts(pdf)).flatMap((page) =>
        page.split("\n"),
      );
      let from = 0;
      for (const [i, line] of expected.lines.entries()) {
        const description = line.description ?? "";
        const total =
          line.lineTotal === null ? "" : formatDecimal(line.lineTotal);
        const found = lines.findIndex(
          (text, at) =>
            at >= from && text.includes(description) && text.includes(total),
        );
        // The id and line number only: the text is document contents.
        expect(found, `${id}: line ${i} not found in order`).toBeGreaterThan(
          -1,
        );
        from = found + 1;
      }
    }
  });

  it("columns stay in place: on every product line of the two-page invoice, the line total ends in the same column, give or take two characters", async () => {
    const { expected, pdf } = goldTextPdfs.find(
      ({ id }) => id === "syn-003-invoice-multi-page",
    )!;
    const lines = (await pdfPageTexts(pdf)).flatMap((page) => page.split("\n"));
    const ends = expected.lines.map((line) => {
      const text = lines.find((l) => l.includes(line.description ?? ""))!;
      return text.trimEnd().length;
    });
    expect(Math.max(...ends) - Math.min(...ends)).toBeLessThanOrEqual(2);
  });

  it("a two-page PDF gives two pages", async () => {
    const { pdf } = goldTextPdfs.find(
      ({ id }) => id === "syn-003-invoice-multi-page",
    )!;
    expect(await pdfPageTexts(pdf)).toHaveLength(2);
    expect(await pdfPageCount(pdf)).toBe(2);
  });

  it("doesn't change the bytes it was given", async () => {
    const { pdf } = goldTextPdfs[0]!;
    const copy = pdf.slice();
    await pdfPageTexts(pdf);
    await renderPdfPages(pdf);
    expect(pdf).toEqual(copy);
  });
});

describe("hasTextLayer: a scan saved as PDF has no usable text", () => {
  it("every gold text PDF has a text layer", async () => {
    for (const { id, pdf } of goldTextPdfs) {
      expect(hasTextLayer(await pdfPageTexts(pdf)), id).toBe(true);
    }
  });

  it("a PDF made only of page images has none", async () => {
    const { pdf } = goldTextPdfs[0]!;
    const scan = await imageOnlyPdf(await renderPdfPages(pdf));
    expect(hasTextLayer(await pdfPageTexts(scan))).toBe(false);
  });

  it("one page with fewer than 20 non-whitespace characters is enough to treat the whole PDF as images", () => {
    const text = "x".repeat(20);
    expect(hasTextLayer([text, text])).toBe(true);
    expect(hasTextLayer([text, " x ".repeat(19)])).toBe(false);
    expect(hasTextLayer([])).toBe(false);
  });
});

describe("renderPdfPages: each page as a JPEG, for a vision model", () => {
  it("one JPEG per page, at most 2000 pixels on the long side, portrait like the page", async () => {
    const { pdf } = goldTextPdfs.find(
      ({ id }) => id === "syn-003-invoice-multi-page",
    )!;
    const pages = await renderPdfPages(pdf);
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect([...page.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      const image = await loadImage(Buffer.from(page));
      expect(Math.max(image.width, image.height)).toBe(MAX_RENDER_LONG_SIDE);
      expect(image.height).toBeGreaterThan(image.width);
    }
  });

  it("a scan's pages render too: one image per page", async () => {
    const { pdf } = goldTextPdfs.find(
      ({ id }) => id === "syn-003-invoice-multi-page",
    )!;
    const scan = await imageOnlyPdf(await renderPdfPages(pdf));
    expect(await renderPdfPages(scan)).toHaveLength(2);
  });

  it("bytes that aren't a readable PDF throw", async () => {
    const broken = new TextEncoder().encode("%PDF-1.7\nnot really a PDF");
    await expect(pdfPageTexts(broken)).rejects.toThrow();
  });
});
