import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExtractedDocument } from "@kitchen-ops/shared";
import { GOLD_DIRECTORY, goldIds, readGoldEntry } from "../gold/gold-set";
import { GoldMeta, type GoldKind } from "../gold/meta";
import type { ModelConfig } from "../llm/config";
import { CLIENT_ROUTING, type ContentPart } from "../llm/extract";
import type { ChatReply, OpenRouterClient } from "../llm/openrouter";
import type { Prompt } from "../llm/prompts";
import { renderPdfPages } from "./pdf";
import {
  extractFile,
  MAX_INPUT_BYTES,
  MAX_PDF_IMAGE_PAGES,
  routeFile,
  sha256Hex,
  type Route,
} from "./route";
import { imageOnlyPdf, plainImage } from "./testing";

const ascii = (text: string) => new TextEncoder().encode(text);

/** Every gold document: its source bytes, kind and answer. */
const gold = goldIds(GOLD_DIRECTORY).map((id) => {
  const entry = readGoldEntry(GOLD_DIRECTORY, id);
  const source = readdirSync(new URL(`${id}/`, GOLD_DIRECTORY)).find((file) =>
    file.startsWith("source."),
  )!;
  return {
    id,
    kind: GoldMeta.parse(entry.meta).kind,
    expected: ExtractedDocument.parse(entry.expected),
    bytes: new Uint8Array(
      readFileSync(new URL(`${id}/${source}`, GOLD_DIRECTORY)),
    ),
  };
});
const goldBytes = (id: string) => gold.find((entry) => entry.id === id)!.bytes;

const ROUTE_FOR: Record<GoldKind, readonly Route[]> = {
  "text-pdf": ["pdf-text"],
  scan: ["pdf-pages", "image"],
  photo: ["image"],
  "facturae-xml": ["facturae-xml"],
};

const vision: ModelConfig = {
  id: "vendor/vision",
  structuredOutput: true,
  vision: true,
};
const textOnly: ModelConfig = {
  id: "vendor/text-only",
  structuredOutput: true,
  vision: false,
};
const prompt: Prompt = { version: "v1", text: "Extract the document." };

/** A fake client answering with `document`, remembering each request. */
function fakeClient(document: ExtractedDocument) {
  const requests: Record<string, unknown>[] = [];
  const client: OpenRouterClient = {
    complete: async (body) => {
      requests.push(structuredClone(body));
      const reply: ChatReply = {
        content: JSON.stringify(document),
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.0001,
      };
      return reply;
    },
  };
  return { client, requests };
}

/** A client that must never be called. */
const noCalls: OpenRouterClient = {
  complete: async () => {
    throw new Error("the model was called");
  },
};

/** The user message's content in a request body. */
function userContent(body: Record<string, unknown>): ContentPart[] {
  const messages = body.messages as { role: string; content: unknown }[];
  return messages.find((message) => message.role === "user")!
    .content as ContentPart[];
}

describe("sha256Hex: the original's hash, to catch duplicates (stage 1)", () => {
  it("is SHA-256 in lower-case hex", () => {
    expect(sha256Hex(ascii("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("routeFile: each kind of input takes its own route", () => {
  it("every gold document takes the route its kind calls for", async () => {
    for (const { id, kind, bytes } of gold) {
      const routed = await routeFile(bytes);
      expect(ROUTE_FOR[kind], id).toContain(routed.route);
    }
  });

  it("every result carries the SHA-256 of the bytes given, rejected files included", async () => {
    const inputs = [
      ...gold.map(({ bytes }) => bytes),
      ascii("not a document"),
      await plainImage("png"),
      ascii("%PDF-1.7\nbroken"),
    ];
    for (const bytes of inputs) {
      expect((await routeFile(bytes)).sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    }
  });

  it("a text PDF goes as one text part, each page after a marker", async () => {
    const routed = await routeFile(goldBytes("syn-003-invoice-multi-page"));
    expect(routed.route).toBe("pdf-text");
    if (routed.route !== "pdf-text") return;
    expect(routed.content).toHaveLength(1);
    const [part] = routed.content;
    expect(part?.type).toBe("text");
    if (part?.type !== "text") return;
    const first = part.text.indexOf("--- Page 1 of 2 ---");
    const second = part.text.indexOf("--- Page 2 of 2 ---");
    expect(first).toBe(0);
    expect(second).toBeGreaterThan(first);
  });

  it("a scan saved as PDF goes as one JPEG per page", async () => {
    const pages = await renderPdfPages(goldBytes("syn-003-invoice-multi-page"));
    const routed = await routeFile(await imageOnlyPdf(pages));
    expect(routed.route).toBe("pdf-pages");
    if (routed.route !== "pdf-pages") return;
    expect(routed.content).toHaveLength(2);
    for (const part of routed.content) {
      expect(part.type).toBe("image_url");
      if (part.type !== "image_url") return;
      expect(part.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    }
  });

  it(`a scan of more than ${MAX_PDF_IMAGE_PAGES} pages is refused rather than sent page by page`, async () => {
    const page = await plainImage("jpeg", 60, 80);
    const pages = Array.from({ length: MAX_PDF_IMAGE_PAGES + 1 }, () => page);
    expect(await routeFile(await imageOnlyPdf(pages))).toMatchObject({
      route: "rejected",
      reason: `the PDF has ${MAX_PDF_IMAGE_PAGES + 1} pages without text: at most ${MAX_PDF_IMAGE_PAGES} are sent as images`,
    });
  });

  it.each(["jpeg", "png"] as const)(
    "a %s photo goes as one image",
    async (format) => {
      const routed = await routeFile(await plainImage(format));
      expect(routed.route).toBe("image");
      if (routed.route !== "image") return;
      expect(routed.content).toHaveLength(1);
      expect(routed.content[0]).toMatchObject({
        type: "image_url",
        image_url: { url: expect.stringMatching(`^data:image/${format};`) },
      });
    },
  );

  it("Facturae is read on the spot, without a model", async () => {
    const routed = await routeFile(goldBytes("syn-006-facturae"));
    expect(routed).toMatchObject({
      route: "facturae-xml",
      result: { status: "extracted" },
    });
  });

  it.each([
    [
      "HEIC, until a real document needs it",
      new Uint8Array([0, 0, 0, 0x18, ...ascii("ftypheic")]),
      "HEIC photos aren't supported yet: convert to JPEG",
    ],
    [
      "a file of no known format",
      ascii("just some text"),
      "not a PDF, JPEG, PNG or XML file",
    ],
    [
      "a PDF that can't be read",
      ascii("%PDF-1.7\nbroken"),
      "the PDF couldn't be read",
    ],
    [
      "XML that isn't Facturae",
      ascii(
        '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
      ),
      "XML that isn't Facturae 3.2, 3.2.1 or 3.2.2",
    ],
  ])("refuses %s, saying why", async (_case, bytes, reason) => {
    expect(await routeFile(bytes)).toMatchObject({ route: "rejected", reason });
  });

  it("refuses a file over 20 MB before reading it", async () => {
    expect(MAX_INPUT_BYTES).toBe(20 * 1024 * 1024);
    const huge = new Uint8Array(MAX_INPUT_BYTES + 1);
    huge.set(ascii("%PDF-1.7\n"));
    expect(await routeFile(huge)).toMatchObject({
      route: "rejected",
      reason: "the file is over 20 MB",
    });
  });
});

describe("extractFile: route, then extract; the model only sees what the route prepared", () => {
  const request = { model: vision, prompt, source: "own-or-public" } as const;

  it("Facturae never reaches a model", async () => {
    const { expected, bytes } = gold.find(
      ({ id }) => id === "syn-006-facturae",
    )!;
    expect(await extractFile(noCalls, bytes, request)).toEqual({
      sha256: sha256Hex(bytes),
      route: "facturae-xml",
      result: { status: "extracted", document: expected, record: null },
    });
  });

  it("a text PDF's text is what the model receives, and its answer comes back with a call record", async () => {
    const { expected, bytes } = gold.find(
      ({ id }) => id === "syn-002-invoice-discounts-two-vat",
    )!;
    const { client, requests } = fakeClient(expected);
    const extraction = await extractFile(client, bytes, request);
    expect(extraction.route).toBe("pdf-text");
    expect(extraction.result).toMatchObject({
      status: "extracted",
      document: expected,
      record: { model: "vendor/vision", promptVersion: "v1", attempts: 1 },
    });
    const routed = await routeFile(bytes);
    expect(routed.route === "pdf-text" && routed.content).toEqual(
      userContent(requests[0]!),
    );
  });

  it("a photo reaches the model as an image", async () => {
    const { expected } = gold[0]!;
    const { client, requests } = fakeClient(expected);
    await extractFile(client, await plainImage("png"), request);
    expect(userContent(requests[0]!).map((part) => part.type)).toEqual([
      "image_url",
    ]);
  });

  it("a client document keeps restricted routing through every route", async () => {
    const { expected } = gold[0]!;
    const { client, requests } = fakeClient(expected);
    const forClient = { ...request, source: "client" } as const;
    await extractFile(
      client,
      goldBytes("syn-002-invoice-discounts-two-vat"),
      forClient,
    );
    await extractFile(client, await plainImage("jpeg"), forClient);
    expect(requests).toHaveLength(2);
    for (const body of requests) {
      expect(body.provider).toMatchObject(CLIENT_ROUTING);
    }
  });

  it("photos and scans are refused for a model that can't read images, before any call", async () => {
    const extraction = await extractFile(noCalls, await plainImage("jpeg"), {
      ...request,
      model: textOnly,
    });
    expect(extraction).toMatchObject({
      route: "image",
      result: {
        status: "rejected",
        reason: "model vendor/text-only can't read images",
        record: null,
      },
    });
  });

  it("a text PDF is fine for a text-only model", async () => {
    const { expected, bytes } = gold.find(
      ({ id }) => id === "syn-002-invoice-discounts-two-vat",
    )!;
    const { client } = fakeClient(expected);
    const extraction = await extractFile(client, bytes, {
      ...request,
      model: textOnly,
    });
    expect(extraction.result.status).toBe("extracted");
  });

  it("a refused file never reaches a model", async () => {
    expect(
      await extractFile(noCalls, ascii("just some text"), request),
    ).toEqual({
      sha256: sha256Hex(ascii("just some text")),
      route: "rejected",
      result: {
        status: "rejected",
        reason: "not a PDF, JPEG, PNG or XML file",
        record: null,
      },
    });
  });
});
