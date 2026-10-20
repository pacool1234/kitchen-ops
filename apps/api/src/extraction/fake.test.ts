import {
  CLIENT_ROUTING,
  defaultExtraction,
  defaultSuggestion,
  extractFiles,
  MAX_AGE_DAYS,
  suggestProducts,
  validate,
} from "@kitchen-ops/extract";
import { ExtractedDocument } from "@kitchen-ops/shared";
import { describe, expect, it } from "vitest";
import { photo } from "../test/documents";
import {
  createFakeClient,
  FAKE_FAILURE_MARKER,
  FAKE_MISREAD_MARKER,
  FAKE_MODEL,
  fakeDocument,
  fakeMisread,
} from "./fake";
import { JOB_SETTINGS } from "./jobs";
import { CALL_TIMEOUT_MS, jobSettingsFor, readerFor } from "./reader";

// The fake model (#104): a fixed, valid extraction without calling OpenRouter, for tests, local
// development and the browser tests. It never runs in production (src/config.ts refuses it).

const TODAY = "2026-10-19";

describe("the fake model", () => {
  it("answers a document that matches the schema and passes every check", () => {
    const document = ExtractedDocument.parse(fakeDocument(TODAY));
    expect(
      validate(document, {
        today: TODAY,
        maxAgeDays: MAX_AGE_DAYS,
        knownNumbers: [],
      }),
    ).toEqual({ passed: true, failures: [] });
    expect(document.issueDate).toBe(TODAY);
  });

  it("reads a photo as extraction does, with client routing, through the same code as the real model", async () => {
    const reader = readerFor(
      { model: "fake" },
      () => new Date(`${TODAY}T10:00:00Z`),
    );
    expect(reader.model).toBe(FAKE_MODEL);
    const extraction = await extractFiles(reader.client, [photo(1)], {
      model: reader.model,
      prompt: reader.prompt,
      source: "client",
    });
    expect(extraction.result).toMatchObject({
      status: "extracted",
      document: fakeDocument(TODAY),
      record: { model: "fake", costMicroUsd: 0 },
    });
  });

  it(`fails, as OpenRouter would with a 503, when the document's text says "${FAKE_FAILURE_MARKER}"`, async () => {
    const client = createFakeClient(() => new Date());
    await expect(
      client.complete({
        provider: CLIENT_ROUTING,
        messages: [
          { role: "user", content: `Albarán 12 ${FAKE_FAILURE_MARKER}` },
        ],
      }),
    ).rejects.toMatchObject({ name: "OpenRouterError", status: 503 });
  });

  it(`misreads line 1's quantity when the document's text says "${FAKE_MISREAD_MARKER}": the line-total check fails on that line, and only it (#118)`, async () => {
    const client = createFakeClient(() => new Date(`${TODAY}T10:00:00Z`));
    const reply = await client.complete({
      provider: CLIENT_ROUTING,
      messages: [
        { role: "user", content: `Albarán 12 ${FAKE_MISREAD_MARKER}` },
      ],
    });
    const document = ExtractedDocument.parse(JSON.parse(reply.content ?? ""));
    expect(document).toEqual(fakeMisread(TODAY));
    const { lines, ...header } = document;
    const { lines: printed, ...printedHeader } = fakeDocument(TODAY);
    expect(header).toEqual(printedHeader);
    expect(lines.slice(1)).toEqual(printed.slice(1));
    expect(lines[0]).toEqual({ ...printed[0], quantity: "50" });
    expect(
      validate(document, {
        today: TODAY,
        maxAgeDays: MAX_AGE_DAYS,
        knownNumbers: [],
      }).failures.map(({ check, path }) => ({ check, path })),
    ).toEqual([{ check: "line-total", path: "lines.0.lineTotal" }]);
  });

  it(`finds its markers in a photo's own bytes too, as a photo has no text: "${FAKE_MISREAD_MARKER}" in a PNG's text chunk (#119)`, async () => {
    const reader = readerFor(
      { model: "fake" },
      () => new Date(`${TODAY}T10:00:00Z`),
    );
    const read = (bytes: Uint8Array) =>
      extractFiles(reader.client, [bytes], {
        model: reader.model,
        prompt: reader.prompt,
        source: "client",
      });
    expect((await read(photo(2, FAKE_MISREAD_MARKER))).result).toMatchObject({
      document: fakeMisread(TODAY),
    });
    expect((await read(photo(3, "nothing to see"))).result).toMatchObject({
      document: fakeDocument(TODAY),
    });
  });
});

describe("the fake model's suggestions (#117)", () => {
  it("suggests the product whose name is in the line's description, ignoring case, the longest if several; none otherwise", async () => {
    const reader = readerFor({ model: "fake" });
    const product = (id: string, name: string) => ({
      id,
      name,
      baseUnit: "g",
      category: "produce",
    });
    const line = (description: string) => ({
      supplierCode: null,
      description,
      unit: "kg",
    });
    const result = await suggestProducts(reader.client, {
      ...reader.suggestion,
      products: [
        product("tomate", "Tomate"),
        product("tomate-pera", "Tomate pera"),
        product("aceite", "Aceite de oliva virgen extra"),
      ],
      lines: [
        line("TOMATE PERA extra"),
        line("Aceite de oliva virgen extra 5 l"),
        line("Servilletas"),
      ],
    });
    expect(result).toMatchObject({
      status: "suggested",
      productIds: ["tomate-pera", "aceite", null],
      record: { model: "fake", costMicroUsd: 0 },
    });
  });
});

describe("the default model", () => {
  it("is decision 0018's, with the key, and each call gives up after its timeout", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const reader = readerFor(
      { model: "default", apiKey: "test-only-key" },
      () => new Date(),
      async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "{}" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
          }),
        );
      },
    );
    expect(reader.model).toEqual(defaultExtraction().model);
    expect(reader.prompt).toEqual(defaultExtraction().prompt);
    expect(reader.suggestion).toEqual(defaultSuggestion());
    await reader.client.complete({ messages: [] });
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe(
      "Bearer test-only-key",
    );
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(CALL_TIMEOUT_MS).toBe(3 * 60_000);
  });
});

describe("how soon a failed try is tried again", () => {
  it("with the fake model, after a second and without backoff, so a browser test sees a failure in seconds (#106)", () => {
    expect(jobSettingsFor({ model: "fake" })).toEqual({
      ...JOB_SETTINGS,
      retryDelaySeconds: 1,
      retryBackoff: false,
    });
  });

  it("with the real model, or none, decision 0030's: 30 seconds, with backoff", () => {
    expect(jobSettingsFor({ model: "default", apiKey: "k" })).toEqual(
      JOB_SETTINGS,
    );
    expect(jobSettingsFor(null)).toEqual(JOB_SETTINGS);
    expect(JOB_SETTINGS).toMatchObject({
      retryDelaySeconds: 30,
      retryBackoff: true,
    });
  });
});
