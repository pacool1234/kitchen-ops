import { createHash } from "node:crypto";
import type { ExtractedDocument } from "@kitchen-ops/shared";
import {
  extractDocument,
  type ContentPart,
  type ExtractionRequest,
  type ExtractionResult,
} from "../llm/extract";
import type { OpenRouterClient } from "../llm/openrouter";
import { detectFormat } from "./detect";
import { parseFacturae } from "./facturae";
import { prepareImage, type ImageFormat } from "./image";
import { hasTextLayer, pdfPageTexts, renderPdfPages } from "./pdf";

// Routing (spec section 5, stage 2): Facturae is read directly, a text PDF goes to the model as
// text, and photos and scans go to a vision model as images. Every result carries the original's
// SHA-256, so a duplicate upload can be caught (stage 1).

/** Larger files are refused before anything reads them. */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
/** A scan with more pages is refused rather than sent page by page. */
export const MAX_PDF_IMAGE_PAGES = 10;

export type Route =
  "facturae-xml" | "pdf-text" | "pdf-pages" | "image" | "rejected";

/** What Facturae gave: values copied from the file, or why it needs a person. */
export type FacturaeOutcome =
  | { readonly status: "extracted"; readonly document: ExtractedDocument }
  | {
      readonly status: "needs-review";
      readonly reason: string;
      readonly issues: readonly string[];
    };

/** A file, ready for extraction: read already, content for a model, or refused. */
export type RoutedFile = { readonly sha256: string } & (
  | { readonly route: "facturae-xml"; readonly result: FacturaeOutcome }
  | {
      readonly route: "pdf-text" | "pdf-pages" | "image";
      readonly content: readonly ContentPart[];
    }
  | { readonly route: "rejected"; readonly reason: string }
);

/** Results that involved no model have no call record. */
export type FileResult =
  | ExtractionResult
  | (FacturaeOutcome & { readonly record: null })
  | {
      readonly status: "rejected";
      readonly reason: string;
      readonly record: null;
    };

export interface FileExtraction {
  readonly sha256: string;
  readonly route: Route;
  readonly result: FileResult;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const imagePart = (url: string): ContentPart => ({
  type: "image_url",
  image_url: { url },
});

async function routePdf(
  bytes: Uint8Array,
  sha256: string,
): Promise<RoutedFile> {
  const rejected = (reason: string): RoutedFile => ({
    sha256,
    route: "rejected",
    reason,
  });
  let pages: string[];
  try {
    pages = await pdfPageTexts(bytes);
  } catch {
    return rejected("the PDF couldn't be read");
  }

  if (hasTextLayer(pages)) {
    const text = pages
      .map((page, i) => `--- Page ${i + 1} of ${pages.length} ---\n${page}`)
      .join("\n\n");
    return { sha256, route: "pdf-text", content: [{ type: "text", text }] };
  }

  if (pages.length > MAX_PDF_IMAGE_PAGES) {
    return rejected(
      `the PDF has ${pages.length} pages without text: at most ${MAX_PDF_IMAGE_PAGES} are sent as images`,
    );
  }
  const content: ContentPart[] = [];
  for (const [i, page] of (await renderPdfPages(bytes)).entries()) {
    const prepared = await prepareImage(page, "jpeg");
    if (!prepared.ok) return rejected(`page ${i + 1}: ${prepared.reason}`);
    content.push(imagePart(prepared.dataUrl));
  }
  return { sha256, route: "pdf-pages", content };
}

async function routeImage(
  bytes: Uint8Array,
  format: ImageFormat,
  sha256: string,
): Promise<RoutedFile> {
  const prepared = await prepareImage(bytes, format);
  return prepared.ok
    ? { sha256, route: "image", content: [imagePart(prepared.dataUrl)] }
    : { sha256, route: "rejected", reason: prepared.reason };
}

/** Detects what the bytes are and prepares them for their route. No model is called. */
export async function routeFile(bytes: Uint8Array): Promise<RoutedFile> {
  const sha256 = sha256Hex(bytes);
  const rejected = (reason: string): RoutedFile => ({
    sha256,
    route: "rejected",
    reason,
  });
  if (bytes.length > MAX_INPUT_BYTES) return rejected("the file is over 20 MB");

  const format = detectFormat(bytes);
  switch (format) {
    case "pdf":
      return routePdf(bytes, sha256);
    case "jpeg":
    case "png":
      return routeImage(bytes, format, sha256);
    case "xml": {
      let xml: string;
      try {
        xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return rejected("the XML isn't UTF-8");
      }
      const result = parseFacturae(xml);
      return result.status === "not-facturae"
        ? rejected(result.reason)
        : { sha256, route: "facturae-xml", result };
    }
    case "heic":
      return rejected("HEIC photos aren't supported yet: convert to JPEG");
    case "unknown":
      return rejected("not a PDF, JPEG, PNG or XML file");
  }
}

/**
 * Routes a file and extracts it. Facturae and refused files never reach a model; photos and
 * scans only reach one that can read images. `source` stays required, so a client document is
 * always sent with restricted routing.
 */
export async function extractFile(
  client: OpenRouterClient,
  bytes: Uint8Array,
  request: Omit<ExtractionRequest, "content">,
  options?: { now?: () => number },
): Promise<FileExtraction> {
  const routed = await routeFile(bytes);
  const { sha256, route } = routed;
  switch (routed.route) {
    case "rejected":
      return {
        sha256,
        route,
        result: { status: "rejected", reason: routed.reason, record: null },
      };
    case "facturae-xml":
      return { sha256, route, result: { ...routed.result, record: null } };
    default: {
      if (routed.route !== "pdf-text" && !request.model.vision) {
        return {
          sha256,
          route,
          result: {
            status: "rejected",
            reason: `model ${request.model.id} can't read images`,
            record: null,
          },
        };
      }
      return {
        sha256,
        route,
        result: await extractDocument(
          client,
          { ...request, content: routed.content },
          options,
        ),
      };
    }
  }
}
