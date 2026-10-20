import {
  ExtractedDocument,
  extractedDocumentJsonSchema,
} from "@kitchen-ops/shared";
import {
  askForJson,
  type CallRecord,
  type ContentPart,
  type DocumentSource,
} from "./ask";
import type { ModelConfig } from "./config";
import type { OpenRouterClient } from "./openrouter";
import type { Prompt } from "./prompts";

// One extraction (spec section 5, stage 3): ask the model, validate with the Zod schema, retry
// once with the validation errors, then send to review. Output is never repaired by guessing.

export {
  CLIENT_ROUTING,
  type CallRecord,
  type ContentPart,
  type DocumentSource,
} from "./ask";

export interface ExtractionRequest {
  readonly model: ModelConfig;
  readonly prompt: Prompt;
  readonly content: readonly ContentPart[];
  /** Required, with no default: a client document can't be sent without restricted routing. */
  readonly source: DocumentSource;
}

export type ExtractionResult =
  | {
      readonly status: "extracted";
      readonly document: ExtractedDocument;
      readonly record: CallRecord;
    }
  | {
      readonly status: "needs-review";
      readonly reason: string;
      /** Field paths and schema messages, never document contents. */
      readonly issues: readonly string[];
      readonly record: CallRecord;
    }
  | {
      readonly status: "failed";
      readonly message: string;
      /** OpenRouter's HTTP status; null for any other error, such as the network failing. */
      readonly httpStatus: number | null;
      readonly record: CallRecord;
    };

export async function extractDocument(
  client: OpenRouterClient,
  request: ExtractionRequest,
  options: { now?: () => number } = {},
): Promise<ExtractionResult> {
  const answer = await askForJson(
    client,
    {
      ...request,
      schema: ExtractedDocument,
      schemaName: "extracted_document",
      jsonSchema: extractedDocumentJsonSchema(),
      retryHint:
        "Reply again with the whole corrected JSON object. Use null for anything not printed or unreadable; don't guess.",
    },
    options,
  );
  switch (answer.status) {
    case "answered":
      return {
        status: "extracted",
        document: answer.value,
        record: answer.record,
      };
    case "invalid":
      return {
        status: "needs-review",
        reason: "the output was invalid twice",
        issues: answer.issues,
        record: answer.record,
      };
    case "failed":
      return answer;
  }
}
