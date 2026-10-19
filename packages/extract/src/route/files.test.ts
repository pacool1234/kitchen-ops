import { readdirSync, readFileSync } from "node:fs";
import { ExtractedDocument } from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GOLD_DIRECTORY, goldIds, readGoldEntry } from "../gold/gold-set";
import type { ModelConfig } from "../llm/config";
import { CLIENT_ROUTING, type ContentPart } from "../llm/extract";
import type { ChatReply, OpenRouterClient } from "../llm/openrouter";
import type { Prompt } from "../llm/prompts";
import { extractFiles, MAX_PHOTOS } from "./files";
import { prepareImage } from "./image";
import { extractFile, sha256Hex } from "./route";
import { plainImage } from "./testing";

// One document from one or several files (#103): a delivery note or invoice of two or three
// pages, photographed a page at a time, is read as one document, its pages in order. No network:
// a fake client stands in for OpenRouter.

const expected = ExtractedDocument.parse(
  readGoldEntry(GOLD_DIRECTORY, goldIds(GOLD_DIRECTORY)[0]!).expected,
);
const vision: ModelConfig = {
  id: "vendor/vision",
  structuredOutput: true,
  vision: true,
};
const prompt: Prompt = { version: "v1", text: "Extract the document." };
const request = { model: vision, prompt, source: "client" } as const;
/** A clock that stands still: two calls compared whole record the same latency. */
const stillClock = { now: () => 0 };

/** A fake client answering with the expected document, remembering each request. */
function fakeClient() {
  const requests: Record<string, unknown>[] = [];
  const client: OpenRouterClient = {
    complete: async (body) => {
      requests.push(structuredClone(body));
      const reply: ChatReply = {
        content: JSON.stringify(expected),
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

/** What the user's message held: the document's content. */
function userContent(body: Record<string, unknown>): ContentPart[] {
  const messages = body.messages as { role: string; content: unknown }[];
  return messages.find((m) => m.role === "user")!.content as ContentPart[];
}

/** A photo of its own: each width gives different bytes. */
const photo = (width: number, format: "jpeg" | "png" = "jpeg") =>
  plainImage(format, width, 400);

/** The data URL a photo reaches the model as. */
async function imageUrl(bytes: Uint8Array): Promise<string> {
  const prepared = await prepareImage(
    bytes,
    bytes[0] === 0x89 ? "png" : "jpeg",
  );
  if (!prepared.ok) throw new Error(prepared.reason);
  return prepared.dataUrl;
}

/** A gold document's source file: a text PDF, a Facturae XML. */
function goldSource(id: string): Uint8Array {
  const directory = new URL(`${id}/`, GOLD_DIRECTORY);
  const source = readdirSync(directory).find((f) => f.startsWith("source."))!;
  return new Uint8Array(readFileSync(new URL(source, directory)));
}

const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
const xml = new TextEncoder().encode(
  '<?xml version="1.0"?><fe:Facturae></fe:Facturae>',
);

describe("extractFiles: one document from its files", () => {
  it("three photos: one call, the pages in the order sent, with client routing", async () => {
    const pages = [await photo(300), await photo(301, "png"), await photo(302)];
    const { client, requests } = fakeClient();
    const extraction = await extractFiles(client, pages, request);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.provider).toMatchObject(CLIENT_ROUTING);
    expect(
      userContent(requests[0]!).map((part) =>
        part.type === "image_url" ? part.image_url.url : part.type,
      ),
    ).toEqual(await Promise.all(pages.map(imageUrl)));
    expect(extraction).toMatchObject({
      sha256s: pages.map(sha256Hex),
      route: "image",
      result: { status: "extracted", document: expected },
    });
  });

  it("one file: exactly what extractFile does, the same request to the model", async () => {
    const page = await photo(300);
    const one = fakeClient();
    const reference = fakeClient();
    const extraction = await extractFiles(
      one.client,
      [page],
      request,
      stillClock,
    );
    const single = await extractFile(
      reference.client,
      page,
      request,
      stillClock,
    );
    expect(one.requests).toEqual(reference.requests);
    expect(extraction).toEqual({
      sha256s: [single.sha256],
      route: single.route,
      result: single.result,
    });
  });

  it.each([
    ["a text PDF", "syn-002-invoice-discounts-two-vat"],
    ["a Facturae XML file", "syn-006-facturae"],
  ])(
    "one file that isn't a photo, %s: exactly what extractFile does",
    async (_, id) => {
      const file = goldSource(id);
      const one = fakeClient();
      const reference = fakeClient();
      const extraction = await extractFiles(
        one.client,
        [file],
        request,
        stillClock,
      );
      const single = await extractFile(
        reference.client,
        file,
        request,
        stillClock,
      );
      expect(one.requests).toEqual(reference.requests);
      expect(extraction).toEqual({
        sha256s: [single.sha256],
        route: single.route,
        result: single.result,
      });
      expect(extraction.result.status).not.toBe("rejected");
    },
  );

  it.each([
    ["no files", async () => [], "a document needs at least one file"],
    [
      `${MAX_PHOTOS + 1} photos`,
      async () =>
        Promise.all(
          Array.from({ length: MAX_PHOTOS + 1 }, (_, i) => photo(300 + i)),
        ),
      `a document has at most ${MAX_PHOTOS} photos`,
    ],
    [
      "a PDF with a photo",
      async () => [pdf, await photo(300)],
      "a PDF or XML file is a document on its own",
    ],
    [
      "a photo with an XML file",
      async () => [await photo(300), xml],
      "a PDF or XML file is a document on its own",
    ],
    [
      "two PDFs",
      async () => [pdf, new TextEncoder().encode("%PDF-1.7\n% two\n")],
      "a PDF or XML file is a document on its own",
    ],
  ])("refuses %s, before any call", async (_, files, reason) => {
    const extraction = await extractFiles(noCalls, await files(), request);
    expect(extraction.result).toEqual({
      status: "rejected",
      reason,
      record: null,
    });
  });

  it("refuses a photo it can't read, naming its position, before any call", async () => {
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const extraction = await extractFiles(
      noCalls,
      [await photo(300), broken],
      request,
    );
    expect(extraction.result).toMatchObject({
      status: "rejected",
      record: null,
    });
    expect(
      extraction.result.status === "rejected" && extraction.result.reason,
    ).toMatch(/^photo 2: /);
  });

  it("refuses several photos for a model that can't read images, before any call", async () => {
    const extraction = await extractFiles(
      noCalls,
      [await photo(300), await photo(301)],
      {
        ...request,
        model: { ...vision, id: "vendor/text-only", vision: false },
      },
    );
    expect(extraction.result).toEqual({
      status: "rejected",
      reason: "model vendor/text-only can't read images",
      record: null,
    });
  });

  it("whatever order two to four pages are sent in, the model sees them in that order", async () => {
    const pages = await Promise.all([300, 310, 320, 330].map((w) => photo(w)));
    const urls = await Promise.all(pages.map(imageUrl));
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray([0, 1, 2, 3], { minLength: 2, maxLength: 4 }),
        async (order) => {
          const { client, requests } = fakeClient();
          await extractFiles(
            client,
            order.map((i) => pages[i]!),
            request,
          );
          expect(
            userContent(requests[0]!).map(
              (part) => part.type === "image_url" && part.image_url.url,
            ),
          ).toEqual(order.map((i) => urls[i]));
        },
      ),
      { numRuns: 30 },
    );
  });
});
