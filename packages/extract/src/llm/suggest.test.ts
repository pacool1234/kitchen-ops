import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ModelConfig } from "./config";
import { CLIENT_ROUTING } from "./extract";
import {
  OpenRouterError,
  type ChatReply,
  type OpenRouterClient,
} from "./openrouter";
import type { Prompt } from "./prompts";
import {
  SUGGESTION_SCHEMA_NAME,
  suggestProducts,
  type CatalogueProduct,
  type SuggestionLine,
} from "./suggest";

// A model suggests which of our products each unmatched line is (#117, decision 0036). The
// products and lines are numbered, the model answers numbers, and anything that doesn't fit is
// dropped. Always with client routing. A fake client only: no network.

const model: ModelConfig = {
  id: "vendor/structured",
  structuredOutput: true,
  vision: false,
};
const prompt: Prompt = { version: "v1", text: "Suggest our products." };

const products: CatalogueProduct[] = [
  {
    id: "product-tomate",
    name: "Tomate pera",
    baseUnit: "g",
    category: "produce",
  },
  {
    id: "product-aceite",
    name: "Aceite de oliva virgen extra",
    baseUnit: "ml",
    category: "dry_goods",
  },
  { id: "product-huevos", name: "Huevos", baseUnit: "unit", category: "dairy" },
];

const lines: SuggestionLine[] = [
  { supplierCode: "T-01", description: "Tomate pera extra", unit: "kg" },
  { supplierCode: null, description: "AOVE garrafa 5 l", unit: "garrafa" },
  { supplierCode: null, description: "Servilletas", unit: null },
];

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

const answer = (value: unknown, cost: number | null = 0.0004): ChatReply => ({
  content: typeof value === "string" ? value : JSON.stringify(value),
  promptTokens: 5000,
  completionTokens: 50,
  cost,
});

const suggestions = (...pairs: [number, number | null][]) => ({
  suggestions: pairs.map(([line, product]) => ({ line, product })),
});

describe("suggestProducts", () => {
  it("sends the lines and our products, numbered from 1, with client routing and structured output", async () => {
    const { client, requests } = fakeClient(
      answer(suggestions([1, 1], [2, 2], [3, null])),
    );
    await suggestProducts(client, { model, prompt, lines, products });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request).toMatchObject({
      model: "vendor/structured",
      provider: { require_parameters: true, ...CLIENT_ROUTING },
      response_format: {
        type: "json_schema",
        json_schema: { name: SUGGESTION_SCHEMA_NAME, strict: true },
      },
    });
    const messages = request!["messages"] as {
      role: string;
      content: string;
    }[];
    expect(messages[0]).toEqual({ role: "system", content: prompt.text });
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toBe(
      [
        "Our products:",
        "1 | Tomate pera | g | produce",
        "2 | Aceite de oliva virgen extra | ml | dry_goods",
        "3 | Huevos | unit | dairy",
        "",
        "The supplier's lines:",
        "1 | T-01 | Tomate pera extra | kg",
        "2 |  | AOVE garrafa 5 l | garrafa",
        "3 |  | Servilletas | ",
      ].join("\n"),
    );
  });

  it("gives each line the product whose number the model answered, or none, with what the call cost", async () => {
    const { client } = fakeClient(
      answer(suggestions([1, 1], [2, 2], [3, null])),
    );
    const result = await suggestProducts(client, {
      model,
      prompt,
      lines,
      products,
    });
    expect(result).toEqual({
      status: "suggested",
      productIds: ["product-tomate", "product-aceite", null],
      record: expect.objectContaining({
        model: "vendor/structured",
        promptVersion: "v1",
        attempts: 1,
        promptTokens: 5000,
        completionTokens: 50,
        costMicroUsd: 400,
      }),
    });
  });

  it("drops what doesn't fit, never guessing: a number outside the list, a line answered twice, a line not asked about; a line left out has none", async () => {
    const four = [
      ...lines,
      { supplierCode: "H", description: "Huevos L", unit: "docena" },
    ];
    const { client } = fakeClient(
      answer(suggestions([1, 4], [2, 1], [2, 2], [7, 1], [0, 1], [4, 3])),
    );
    const result = await suggestProducts(client, {
      model,
      prompt,
      lines: four,
      products,
    });
    expect(result).toMatchObject({
      status: "suggested",
      productIds: [null, null, null, "product-huevos"],
    });
  });

  it("an answer that doesn't fit the schema is asked again once, with what was wrong", async () => {
    const { client, requests } = fakeClient(
      answer("not json"),
      answer(suggestions([1, 1], [2, null], [3, null])),
    );
    const result = await suggestProducts(client, {
      model,
      prompt,
      lines,
      products,
    });
    expect(result).toMatchObject({
      status: "suggested",
      productIds: ["product-tomate", null, null],
      record: { attempts: 2, costMicroUsd: 800 },
    });
    const retry = requests[1]!["messages"] as {
      role: string;
      content: string;
    }[];
    expect(retry.at(-1)?.content).toMatch(/doesn't match the schema/);
  });

  it("two answers that don't fit: failed, invalid_output, both paid for", async () => {
    const { client } = fakeClient(
      answer("{}"),
      answer({ suggestions: "none" }),
    );
    expect(
      await suggestProducts(client, { model, prompt, lines, products }),
    ).toMatchObject({
      status: "failed",
      reason: "invalid_output",
      record: { attempts: 2, costMicroUsd: 800 },
    });
  });

  it("an error from OpenRouter, or the network, isn't asked again: model_error, model_unreachable", async () => {
    const refused = fakeClient(new OpenRouterError("no endpoints", 404));
    expect(
      await suggestProducts(refused.client, { model, prompt, lines, products }),
    ).toMatchObject({ status: "failed", reason: "model_error" });
    expect(refused.requests).toHaveLength(1);

    const offline = fakeClient(new Error("fetch failed"));
    expect(
      await suggestProducts(offline.client, { model, prompt, lines, products }),
    ).toMatchObject({ status: "failed", reason: "model_unreachable" });
  });

  it("a model without structured output gets the schema in its prompt, still with client routing", async () => {
    const { client, requests } = fakeClient(
      answer(suggestions([1, null], [2, null], [3, null])),
    );
    await suggestProducts(client, {
      model: { ...model, structuredOutput: false },
      prompt,
      lines,
      products,
    });
    expect(requests[0]).not.toHaveProperty("response_format");
    expect(requests[0]!["provider"]).toEqual(CLIENT_ROUTING);
    const messages = requests[0]!["messages"] as { content: string }[];
    expect(messages[0]?.content).toMatch(/JSON Schema/);
  });
});

describe("properties", () => {
  it("whatever numbers the model answers, each line gets one of the products sent or none, and a line answered once with a number in the list gets that product", async () => {
    const number = fc.integer({ min: -2, max: 6 });
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            line: number,
            product: fc.option(number, { nil: null }),
          }),
          { maxLength: 8 },
        ),
        async (answered) => {
          const { client } = fakeClient(answer({ suggestions: answered }));
          const result = await suggestProducts(client, {
            model,
            prompt,
            lines,
            products,
          });
          if (result.status !== "suggested") throw new Error(result.status);
          expect(result.productIds).toHaveLength(lines.length);
          const ids = new Set(products.map((p) => p.id));
          result.productIds.forEach((id, i) => {
            expect(id === null || ids.has(id)).toBe(true);
            const forLine = answered.filter((a) => a.line === i + 1);
            const only = forLine.length === 1 ? forLine[0]!.product : null;
            const expected =
              only !== null && only >= 1 && only <= products.length
                ? products[only - 1]!.id
                : null;
            expect(id).toBe(expected);
          });
        },
      ),
    );
  });
});
