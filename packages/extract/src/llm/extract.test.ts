import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  extractedDocumentJsonSchema,
  type ExtractedDocument,
} from "@kitchen-ops/shared";
import type { ModelConfig } from "./config";
import {
  CLIENT_ROUTING,
  extractDocument,
  type ExtractionRequest,
} from "./extract";
import {
  OpenRouterError,
  type ChatReply,
  type OpenRouterClient,
} from "./openrouter";
import type { Prompt } from "./prompts";

// A fictional delivery note, as a model would return it.
const valid: ExtractedDocument = {
  documentType: "delivery-note",
  currency: "EUR",
  supplier: { name: "Proveedor Ficticio S.L.", taxId: "B00123455" },
  number: "ALB-1",
  issueDate: "2026-10-14",
  totals: null,
  lines: [
    {
      supplierCode: null,
      description: "Tomate",
      quantity: "2",
      unit: "caja",
      unitPrice: null,
      discountPercent: null,
      vatRate: null,
      lineTotal: null,
    },
  ],
};
const invalid = { ...valid, lines: [] };

const structured: ModelConfig = {
  id: "vendor/structured",
  structuredOutput: true,
  vision: false,
};
const plain: ModelConfig = {
  id: "vendor/plain",
  structuredOutput: false,
  vision: false,
};
const prompt: Prompt = { version: "v1", text: "Extract the document." };
const content = [{ type: "text" as const, text: "ALBARÁN ALB-1 …" }];

/** A fake client that answers with the replies given, in order, and remembers the requests. */
function fakeClient(...replies: (ChatReply | Error)[]) {
  const requests: Record<string, unknown>[] = [];
  const client: OpenRouterClient = {
    complete: async (body) => {
      requests.push(structuredClone(body) as Record<string, unknown>);
      const next = replies.shift();
      if (next === undefined) throw new Error("no more fake replies");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, requests };
}

const answer = (
  content: string | null,
  cost: number | null = 0.0005,
): ChatReply => ({
  content,
  promptTokens: 1000,
  completionTokens: 200,
  cost,
});

/** A clock that moves 1.5 s per reading. */
function clock() {
  let time = 0;
  return () => (time += 1500);
}

const request = (
  overrides: Partial<ExtractionRequest> = {},
): ExtractionRequest => ({
  model: structured,
  prompt,
  content,
  source: "own-or-public",
  ...overrides,
});

describe("extractDocument: valid output", () => {
  it("valid the first time: extracted, one attempt, tokens and cost from usage", async () => {
    const { client } = fakeClient(answer(JSON.stringify(valid)));
    const result = await extractDocument(client, request(), { now: clock() });
    expect(result).toEqual({
      status: "extracted",
      document: valid,
      record: {
        model: "vendor/structured",
        promptVersion: "v1",
        attempts: 1,
        promptTokens: 1000,
        completionTokens: 200,
        costMicroUsd: 500,
        latencyMs: 1500,
        structuredOutputFailed: false,
      },
    });
  });

  it("a reply wrapped in a ```json fence is accepted: removing the fence changes no value", async () => {
    const { client } = fakeClient(
      answer("```json\n" + JSON.stringify(valid) + "\n```"),
    );
    expect(
      await extractDocument(client, request(), { now: clock() }),
    ).toMatchObject({
      status: "extracted",
      document: valid,
    });
  });
});

describe("extractDocument: one retry, then review", () => {
  it("invalid, then valid: the retry sends back the model's answer and the validation errors", async () => {
    const first = JSON.stringify(invalid);
    const { client, requests } = fakeClient(
      answer(first),
      answer(JSON.stringify(valid)),
    );
    const result = await extractDocument(client, request(), { now: clock() });
    expect(result).toMatchObject({
      status: "extracted",
      record: {
        attempts: 2,
        promptTokens: 2000,
        completionTokens: 400,
        costMicroUsd: 1000,
        structuredOutputFailed: true,
      },
    });
    const retry = requests[1] as {
      messages: { role: string; content: unknown }[];
    };
    expect(retry.messages.at(-2)).toEqual({
      role: "assistant",
      content: first,
    });
    expect(retry.messages.at(-1)).toMatchObject({ role: "user" });
    expect(String(retry.messages.at(-1)!.content)).toContain(
      "lines: Too small: expected array to have >=1 items",
    );
  });

  it("invalid twice: needs review, naming the failing paths; never a guessed repair", async () => {
    const { client } = fakeClient(
      answer(JSON.stringify(invalid)),
      answer(JSON.stringify(invalid)),
    );
    expect(await extractDocument(client, request(), { now: clock() })).toEqual({
      status: "needs-review",
      reason: "the output was invalid twice",
      issues: ["lines: Too small: expected array to have >=1 items"],
      record: expect.objectContaining({
        attempts: 2,
        structuredOutputFailed: true,
      }),
    });
  });

  it("not JSON, or an empty reply, counts as invalid output", async () => {
    const { client } = fakeClient(
      answer("Here is the data: tomato"),
      answer(null),
    );
    expect(
      await extractDocument(client, request(), { now: clock() }),
    ).toMatchObject({
      status: "needs-review",
      issues: ["the reply was empty"],
      record: { attempts: 2 },
    });
  });

  it("a model without structured output that answers wrongly isn't a structured-output failure", async () => {
    const { client } = fakeClient(
      answer("not json"),
      answer(JSON.stringify(valid)),
    );
    expect(
      await extractDocument(client, request({ model: plain }), {
        now: clock(),
      }),
    ).toMatchObject({ record: { structuredOutputFailed: false, attempts: 2 } });
  });
});

describe("extractDocument: errors from OpenRouter", () => {
  it("an HTTP error fails the extraction, without a retry", async () => {
    const { client, requests } = fakeClient(
      new OpenRouterError("OpenRouter answered 429: Rate limit exceeded", 429),
    );
    expect(await extractDocument(client, request(), { now: clock() })).toEqual({
      status: "failed",
      message: "OpenRouter answered 429: Rate limit exceeded",
      httpStatus: 429,
      record: expect.objectContaining({ attempts: 1, costMicroUsd: 0 }),
    });
    expect(requests).toHaveLength(1);
  });

  it("an error that isn't OpenRouter's, such as the network failing, has no HTTP status", async () => {
    const { client } = fakeClient(new TypeError("fetch failed"));
    expect(
      await extractDocument(client, request(), { now: clock() }),
    ).toMatchObject({
      status: "failed",
      message: "fetch failed",
      httpStatus: null,
    });
  });

  it("an error on the retry also fails, counting both attempts", async () => {
    const { client } = fakeClient(
      answer("not json"),
      new OpenRouterError("OpenRouter answered 500: Internal error", 500),
    );
    expect(
      await extractDocument(client, request(), { now: clock() }),
    ).toMatchObject({
      status: "failed",
      httpStatus: 500,
      record: { attempts: 2, costMicroUsd: 500 },
    });
  });

  it("a cost OpenRouter didn't report makes the record's cost unknown, not 0", async () => {
    const { client } = fakeClient(answer(JSON.stringify(valid), null));
    expect(
      await extractDocument(client, request(), { now: clock() }),
    ).toMatchObject({
      record: { costMicroUsd: null },
    });
  });
});

describe("extractDocument: the request", () => {
  it("a structured-output model gets the JSON Schema as response_format, and only endpoints that honour it", async () => {
    const { client, requests } = fakeClient(answer(JSON.stringify(valid)));
    await extractDocument(client, request(), { now: clock() });
    expect(requests[0]).toEqual({
      model: "vendor/structured",
      messages: [
        { role: "system", content: "Extract the document." },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extracted_document",
          strict: true,
          schema: extractedDocumentJsonSchema(),
        },
      },
      provider: { require_parameters: true },
    });
  });

  it("a model without structured output gets the schema in the prompt instead", async () => {
    const { client, requests } = fakeClient(answer(JSON.stringify(valid)));
    await extractDocument(client, request({ model: plain }), { now: clock() });
    const body = requests[0] as { messages: { content: string }[] };
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("provider");
    expect(body.messages[0]!.content).toContain("Extract the document.");
    expect(body.messages[0]!.content).toContain(
      JSON.stringify(extractedDocumentJsonSchema()),
    );
  });
});

describe("extractDocument: the temperature (#68)", () => {
  it("a model with a temperature sends it, on every attempt, exactly as configured", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.constantFrom(structured, plain),
        async (temperature, model) => {
          const { client, requests } = fakeClient(
            answer("not json"),
            answer(JSON.stringify(valid)),
          );
          await extractDocument(
            client,
            request({ model: { ...model, temperature } }),
            { now: clock() },
          );
          expect(requests).toHaveLength(2);
          for (const body of requests) {
            expect(body.temperature).toBe(temperature);
          }
        },
      ),
    );
  });

  it("a model without one sends none: the provider's default applies", async () => {
    const { client, requests } = fakeClient(answer(JSON.stringify(valid)));
    await extractDocument(client, request({ model: plain }), { now: clock() });
    expect(requests[0]).not.toHaveProperty("temperature");
  });
});

describe("extractDocument: client documents only go to providers that neither train on nor keep them", () => {
  it("a client document's request carries data_collection deny and zero data retention", async () => {
    const { client, requests } = fakeClient(answer(JSON.stringify(valid)));
    await extractDocument(client, request({ source: "client" }), {
      now: clock(),
    });
    expect(requests[0]).toMatchObject({
      provider: {
        data_collection: "deny",
        zdr: true,
        require_parameters: true,
      },
    });
    expect(CLIENT_ROUTING).toEqual({ data_collection: "deny", zdr: true });
  });

  it("also on the retry, and also for a model without structured output", async () => {
    const { client, requests } = fakeClient(
      answer("not json"),
      answer(JSON.stringify(valid)),
    );
    await extractDocument(client, request({ source: "client", model: plain }), {
      now: clock(),
    });
    for (const body of requests) {
      expect(body).toMatchObject({
        provider: { data_collection: "deny", zdr: true },
      });
    }
  });

  it("an own or public document isn't restricted", async () => {
    const { client, requests } = fakeClient(answer(JSON.stringify(valid)));
    await extractDocument(client, request(), { now: clock() });
    expect(requests[0]).not.toMatchObject({
      provider: { data_collection: "deny" },
    });
  });

  it("a request must say where the document comes from: leaving it out doesn't compile", () => {
    // @ts-expect-error: `source` is required, so a client document can't skip restricted routing.
    const missing: ExtractionRequest = { model: structured, prompt, content };
    expect(missing).not.toHaveProperty("source");
  });
});
