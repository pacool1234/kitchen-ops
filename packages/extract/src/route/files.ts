import { UPLOAD_LIMITS } from "@kitchen-ops/shared";
import {
  extractDocument,
  type ContentPart,
  type ExtractionRequest,
} from "../llm/extract";
import type { OpenRouterClient } from "../llm/openrouter";
import { detectFormat } from "./detect";
import { prepareImage } from "./image";
import { extractFile, sha256Hex, type FileResult, type Route } from "./route";

// One document from its files (#103): a PDF or Facturae file on its own, or one or several photos
// of a delivery note or invoice, a page each, read as one document in the order they were taken.
// Several photos go to the model as images in one request, as a scanned PDF's pages already do;
// the prompt asks for every line "including lines on later pages", so nothing is added to it.

/** The most photos one document may have: the upload's own limit (#102), one number for both. */
export const MAX_PHOTOS = UPLOAD_LIMITS.maxPhotos;

/** What extraction made of a document's files. */
export interface DocumentExtraction {
  /** Each file's SHA-256, in the order the files were given. */
  readonly sha256s: readonly string[];
  readonly route: Route;
  readonly result: FileResult;
}

const rejected = (
  sha256s: readonly string[],
  route: Route,
  reason: string,
): DocumentExtraction => ({
  sha256s,
  route,
  result: { status: "rejected", reason, record: null },
});

/**
 * Reads one document from its files. One file goes through `extractFile`, as before. Several
 * must all be photos, at most `MAX_PHOTOS`: anything else is refused before any
 * model is called. `source` stays required: a client document is always sent with restricted
 * routing.
 */
export async function extractFiles(
  client: OpenRouterClient,
  files: readonly Uint8Array[],
  request: Omit<ExtractionRequest, "content">,
  options?: { now?: () => number },
): Promise<DocumentExtraction> {
  const sha256s = files.map(sha256Hex);
  if (files.length === 0) {
    return rejected(sha256s, "rejected", "a document needs at least one file");
  }
  if (files.length === 1) {
    const { sha256, route, result } = await extractFile(
      client,
      files[0]!,
      request,
      options,
    );
    return { sha256s: [sha256], route, result };
  }

  if (files.length > MAX_PHOTOS) {
    return rejected(
      sha256s,
      "rejected",
      `a document has at most ${MAX_PHOTOS} photos`,
    );
  }
  const formats = files.map(detectFormat);
  if (formats.some((format) => format !== "jpeg" && format !== "png")) {
    return rejected(
      sha256s,
      "rejected",
      "a PDF or XML file is a document on its own",
    );
  }
  if (!request.model.vision) {
    return rejected(
      sha256s,
      "image",
      `model ${request.model.id} can't read images`,
    );
  }

  // Each page prepared as a single photo is; one that can't be stops the whole document.
  const content: ContentPart[] = [];
  for (const [i, bytes] of files.entries()) {
    const prepared = await prepareImage(
      bytes,
      formats[i] === "png" ? "png" : "jpeg",
    );
    if (!prepared.ok) {
      return rejected(
        sha256s,
        "rejected",
        `photo ${i + 1}: ${prepared.reason}`,
      );
    }
    content.push({ type: "image_url", image_url: { url: prepared.dataUrl } });
  }
  return {
    sha256s,
    route: "image",
    result: await extractDocument(client, { ...request, content }, options),
  };
}
