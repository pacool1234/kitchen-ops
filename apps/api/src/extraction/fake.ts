import {
  OpenRouterError,
  SUGGESTION_SCHEMA_NAME,
  type ChatReply,
  type ModelConfig,
  type OpenRouterClient,
} from "@kitchen-ops/extract";
import type { ExtractedDocument } from "@kitchen-ops/shared";
import { today } from "./read";

// The fake model (#104, EXTRACTION_MODEL=fake): it answers a fixed, valid extraction without
// calling OpenRouter, for tests, local development and the browser tests. Hand-written, not a
// model's answer, and dated the day it's asked, so the date check passes. Asked to suggest
// products (#117), it names the one whose name is in the line's description. Markers in a
// document make it fail, misread a quantity (#118), or read the invoice for its delivery note
// (#120): in a PDF's text, or in a photo's own bytes, as a test photo carries one in a PNG text
// chunk (#119). src/config.ts refuses it in production.

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
    deliveryNotes: [],
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

/**
 * Text in a document that makes the fake model misread it (#118): the delivery note, with line
 * 1's 5 kg read as 50, so its line total fails the checks and review has something to correct.
 */
export const FAKE_MISREAD_MARKER = "fake-model:misread";

/** The delivery note, with line 1's quantity misread. */
export function fakeMisread(issueDate: string): ExtractedDocument {
  const document = fakeDocument(issueDate);
  const [first, ...rest] = document.lines;
  return { ...document, lines: [{ ...first!, quantity: "50" }, ...rest] };
}

/**
 * Text in a document that makes the fake model read the invoice for its delivery note (#120):
 * the oil 1,50 € a garrafa dearer than the delivery note said, so posting it corrects a price.
 */
export const FAKE_INVOICE_MARKER = "fake-model:invoice";

/** The invoice for the delivery note: FAC-0001, listing ALB-0001, the oil at €26.00. */
export function fakeInvoice(issueDate: string): ExtractedDocument {
  const note = fakeDocument(issueDate);
  const [tomatoes, oil] = note.lines;
  return {
    ...note,
    documentType: "invoice",
    number: "FAC-0001",
    deliveryNotes: [note.number!],
    totals: {
      net: "61.00",
      vat: [{ rate: "10", base: "61.00", amount: "6.10" }],
      total: "67.10",
    },
    lines: [tomatoes!, { ...oil!, unitPrice: "26.00", lineTotal: "52.00" }],
  };
}

/** The rows of one numbered list in a suggestion question: "1 | Tomate pera | g | produce". */
function rowsAfter(question: string, heading: string): string[][] {
  const [, after = ""] = question.split(`${heading}\n`);
  const [list = ""] = after.split("\n\n");
  return list
    .split("\n")
    .filter((row) => row !== "")
    .map((row) => row.split(" | "));
}

/**
 * Each line's product: the longest of our products' names found in its description, ignoring
 * case, by its number; null if none is.
 */
function fakeSuggestions(question: string) {
  const products = rowsAfter(question, "Our products:");
  const lines = rowsAfter(question, "The supplier's lines:");
  return {
    suggestions: lines.map(([line, , description = ""]) => {
      const found = products
        .filter(([, name = ""]) =>
          description.toLowerCase().includes(name.toLowerCase()),
        )
        .sort(([, a = ""], [, b = ""]) => b.length - a.length)[0];
      return { line: Number(line), product: found ? Number(found[0]) : null };
    }),
  };
}

/**
 * What a document says to the fake model: the messages' text, and each photo's own bytes,
 * decoded from its data URL. A photo has no text, so a test's carries its marker in them.
 */
function whatItSays(messages: unknown): string {
  const asked = JSON.stringify(messages ?? []);
  const photos = [
    ...asked.matchAll(/data:image\/\w+;base64,([A-Za-z0-9+/=]+)/g),
  ].map(([, base64]) => Buffer.from(base64!, "base64").toString("latin1"));
  return [asked, ...photos].join("\n");
}

const isSuggestion = (body: Record<string, unknown>) =>
  (body.response_format as { json_schema?: { name?: string } } | undefined)
    ?.json_schema?.name === SUGGESTION_SCHEMA_NAME;

export function createFakeClient(now: () => Date): OpenRouterClient {
  return {
    complete: async (body): Promise<ChatReply> => {
      const asked = whatItSays(body.messages);
      if (asked.includes(FAKE_FAILURE_MARKER)) {
        throw new OpenRouterError("the fake model was told to fail", 503);
      }
      if (isSuggestion(body)) {
        const [, question] = body.messages as { content: string }[];
        return {
          content: JSON.stringify(fakeSuggestions(question?.content ?? "")),
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
        };
      }
      const read = asked.includes(FAKE_MISREAD_MARKER)
        ? fakeMisread
        : asked.includes(FAKE_INVOICE_MARKER)
          ? fakeInvoice
          : fakeDocument;
      return {
        content: JSON.stringify(read(today(now()))),
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
      };
    },
  };
}
