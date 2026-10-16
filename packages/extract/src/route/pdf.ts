import { createRequire } from "node:module";
import { dirname } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

// PDFs (spec section 5, stage 2), read with Mozilla's PDF.js. A text PDF's text goes to the model
// as text; a scan saved as PDF has no usable text, so its pages go as images, rendered here with
// @napi-rs/canvas: the PDF itself never leaves for a third-party parser.

/** Pages are rendered at this many pixels on their long side: an A4 page at about 170 dpi. */
export const MAX_RENDER_LONG_SIDE = 2000;
/** A page with fewer non-whitespace characters than this has no usable text layer. */
export const MIN_PAGE_CHARACTERS = 20;
const JPEG_QUALITY = 85;
/** One character of extracted text per this many points across the page, so columns line up. */
const POINTS_PER_COLUMN = 4;

/** PDF.js folder, with forward slashes: it wants folder paths that end in "/", on Windows too. */
const PDFJS = dirname(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
).replaceAll("\\", "/");

async function withPdf<T>(
  bytes: Uint8Array,
  use: (pdf: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const task = getDocument({
    // A copy: PDF.js may take over the buffer it's given.
    data: bytes.slice(),
    // Fonts a PDF names but doesn't embed (Helvetica…), and character maps.
    standardFontDataUrl: `${PDFJS}/standard_fonts/`,
    cMapUrl: `${PDFJS}/cmaps/`,
    cMapPacked: true,
    verbosity: 0, // errors only
  });
  try {
    return await use(await task.promise);
  } finally {
    await task.destroy();
  }
}

export function pdfPageCount(bytes: Uint8Array): Promise<number> {
  return withPdf(bytes, async (pdf) => pdf.numPages);
}

interface Row {
  readonly y: number;
  readonly items: TextItem[];
}

/**
 * One page's text items as lines, top to bottom. Items on the same baseline form one line, placed
 * at a column that follows their position on the page, so a table's columns stay aligned and an
 * empty cell (no discount, say) stays visible as space.
 */
function pageText(items: readonly TextItem[]): string {
  const rows: Row[] = [];
  for (const item of items) {
    if (item.str.trim() === "") continue;
    const y = item.transform[5] ?? 0;
    const tolerance = Math.max(1, item.height / 2);
    const row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ y, items: [item] });
  }
  const x = (item: TextItem) => item.transform[4] ?? 0;
  const left = Math.min(...rows.flatMap((row) => row.items.map(x)));

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      let line = "";
      let previousEnd = -Infinity;
      for (const item of row.items.sort((a, b) => x(a) - x(b))) {
        const gap = x(item) - previousEnd;
        if (gap < item.height * 0.15) {
          // Pieces of one word or phrase, split by the PDF.
          line += item.str;
        } else {
          const column = Math.round((x(item) - left) / POINTS_PER_COLUMN);
          line += " ".repeat(
            Math.max(line === "" ? 0 : 1, column - line.length),
          );
          line += item.str;
        }
        previousEnd = x(item) + item.width;
      }
      return line.trimEnd();
    })
    .join("\n");
}

/** The text of each page. Throws if the bytes aren't a readable PDF. */
export function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  return withPdf(bytes, async (pdf) => {
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        pageText(
          content.items.filter((item): item is TextItem => "str" in item),
        ),
      );
    }
    return pages;
  });
}

/**
 * Whether the text is usable: every page has some. One page without text (a scanned page) sends
 * the whole PDF as images, which carry everything.
 */
export function hasTextLayer(pages: readonly string[]): boolean {
  return (
    pages.length > 0 &&
    pages.every((page) => page.replace(/\s/g, "").length >= MIN_PAGE_CHARACTERS)
  );
}

type Canvas = Parameters<PDFPageProxy["render"]>[0]["canvas"];

/** Each page as a JPEG, MAX_RENDER_LONG_SIDE pixels on its long side. */
export function renderPdfPages(bytes: Uint8Array): Promise<Uint8Array[]> {
  return withPdf(bytes, async (pdf) => {
    const images: Uint8Array[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: MAX_RENDER_LONG_SIDE / Math.max(width, height),
      });
      const canvas = createCanvas(
        Math.round(viewport.width),
        Math.round(viewport.height),
      );
      // @napi-rs/canvas is the canvas PDF.js itself uses in Node; its types are the browser's.
      await page.render({ canvas: canvas as unknown as Canvas, viewport })
        .promise;
      images.push(new Uint8Array(await canvas.encode("jpeg", JPEG_QUALITY)));
    }
    return images;
  });
}
