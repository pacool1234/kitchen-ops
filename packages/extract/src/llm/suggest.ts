import {
  ProductSuggestions,
  productSuggestionsJsonSchema,
} from "@kitchen-ops/shared";
import { askForJson, type CallRecord } from "./ask";
import type { ModelConfig } from "./config";
import type { OpenRouterClient } from "./openrouter";
import type { Prompt } from "./prompts";

// Suggesting which of our products each line is, when nothing matched it (#117, decision 0036).
// Products and lines are numbered from 1, and the model answers numbers: it can't name a
// product we don't have. Whatever doesn't fit is dropped, never guessed. A line's text is a
// client document's, so it's always sent with client routing.

/** The name OpenRouter's structured output gives the answer's schema. */
export const SUGGESTION_SCHEMA_NAME = "product_suggestions";

/** A line as read. */
export interface SuggestionLine {
  readonly supplierCode: string | null;
  readonly description: string | null;
  readonly unit: string | null;
}

/** One of our products. */
export interface CatalogueProduct {
  readonly id: string;
  readonly name: string;
  readonly baseUnit: string;
  readonly category: string;
}

export interface SuggestionRequest {
  readonly model: ModelConfig;
  readonly prompt: Prompt;
  readonly lines: readonly SuggestionLine[];
  readonly products: readonly CatalogueProduct[];
}

export type SuggestionResult =
  | {
      readonly status: "suggested";
      /** One per line, in order: a product's ID, or null for none. */
      readonly productIds: readonly (string | null)[];
      readonly record: CallRecord;
    }
  | {
      readonly status: "failed";
      readonly reason: "model_error" | "model_unreachable" | "invalid_output";
      readonly record: CallRecord;
    };

/** The question: our products, then the supplier's lines, one per row, numbered from 1. */
export function suggestionContent(
  lines: readonly SuggestionLine[],
  products: readonly CatalogueProduct[],
): string {
  return [
    "Our products:",
    ...products.map(
      (p, i) => `${i + 1} | ${p.name} | ${p.baseUnit} | ${p.category}`,
    ),
    "",
    "The supplier's lines:",
    ...lines.map(
      (l, i) =>
        `${i + 1} | ${l.supplierCode ?? ""} | ${l.description ?? ""} | ${l.unit ?? ""}`,
    ),
  ].join("\n");
}

/**
 * Each line's product from the model's numbers: one in the list, for a line asked about and
 * answered once. Anything else gives that line none.
 */
function productIdsFrom(
  answer: ProductSuggestions,
  lineCount: number,
  products: readonly CatalogueProduct[],
): (string | null)[] {
  return Array.from({ length: lineCount }, (_, i) => {
    const forLine = answer.suggestions.filter((s) => s.line === i + 1);
    const product = forLine.length === 1 ? forLine[0]!.product : null;
    return product !== null && product >= 1 && product <= products.length
      ? products[product - 1]!.id
      : null;
  });
}

export async function suggestProducts(
  client: OpenRouterClient,
  { model, prompt, lines, products }: SuggestionRequest,
  options: { now?: () => number } = {},
): Promise<SuggestionResult> {
  const answer = await askForJson(
    client,
    {
      model,
      prompt,
      content: suggestionContent(lines, products),
      // Always: a supplier's lines are a client document's contents (decision 0007).
      source: "client",
      schema: ProductSuggestions,
      schemaName: SUGGESTION_SCHEMA_NAME,
      jsonSchema: productSuggestionsJsonSchema(),
      retryHint:
        "Reply again with the whole corrected JSON object. Use null for a line none of our products clearly is; don't guess.",
    },
    options,
  );
  switch (answer.status) {
    case "answered":
      return {
        status: "suggested",
        productIds: productIdsFrom(answer.value, lines.length, products),
        record: answer.record,
      };
    case "invalid":
      return {
        status: "failed",
        reason: "invalid_output",
        record: answer.record,
      };
    case "failed":
      return {
        status: "failed",
        reason:
          answer.httpStatus === null ? "model_unreachable" : "model_error",
        record: answer.record,
      };
  }
}
