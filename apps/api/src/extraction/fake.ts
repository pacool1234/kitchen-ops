import {
  OpenRouterError,
  type ChatReply,
  type ModelConfig,
  type OpenRouterClient,
} from "@kitchen-ops/extract";
import type { ExtractedDocument } from "@kitchen-ops/shared";
import { today } from "./read";

// The fake model (#104, EXTRACTION_MODEL=fake): it answers a fixed, valid extraction without
// calling OpenRouter, for tests, local development and the browser tests. Hand-written, not a
// model's answer, and dated the day it's asked, so the date check passes. src/config.ts refuses
// it in production.

export const FAKE_MODEL: ModelConfig = {
  id: "fake",
  structuredOutput: true,
  vision: true,
};

/** Text in a document that makes the fake model fail every time, as OpenRouter would with a 503. */
export const FAKE_FAILURE_MARKER = "fake-model:fail";

/** A delivery note from a fictional supplier: B00000018 is a valid CIF in a province that doesn't exist. */
export function fakeDocument(issueDate: string): ExtractedDocument {
  return {
    documentType: "delivery-note",
    currency: "EUR",
    supplier: {
      name: "Distribuciones de Ejemplo, S.L.",
      taxId: "B00000018",
    },
    number: "ALB-0001",
    issueDate,
    totals: {
      net: "58.00",
      vat: [{ rate: "10", base: "58.00", amount: "5.80" }],
      total: "63.80",
    },
    lines: [
      {
        supplierCode: "T-01",
        description: "Tomate pera",
        quantity: "5",
        unit: "kg",
        unitPrice: "1.80",
        discountPercent: null,
        vatRate: "10",
        lineTotal: "9.00",
      },
      {
        supplierCode: "A-05",
        description: "Aceite de oliva virgen extra 5 l",
        quantity: "2",
        unit: "garrafa",
        unitPrice: "24.50",
        discountPercent: null,
        vatRate: "10",
        lineTotal: "49.00",
      },
    ],
  };
}

export function createFakeClient(now: () => Date): OpenRouterClient {
  return {
    complete: async (body): Promise<ChatReply> => {
      if (JSON.stringify(body.messages ?? []).includes(FAKE_FAILURE_MARKER)) {
        throw new OpenRouterError("the fake model was told to fail", 503);
      }
      return {
        content: JSON.stringify(fakeDocument(today(now()))),
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
      };
    },
  };
}
