import {
  CLIENT_ROUTING,
  defaultExtraction,
  extractFiles,
  MAX_AGE_DAYS,
  validate,
} from "@kitchen-ops/extract";
import { ExtractedDocument } from "@kitchen-ops/shared";
import { describe, expect, it } from "vitest";
import { photo } from "../test/documents";
import {
  createFakeClient,
  FAKE_FAILURE_MARKER,
  FAKE_MODEL,
  fakeDocument,
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
