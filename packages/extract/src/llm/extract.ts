import {
  ExtractedDocument,
  extractedDocumentJsonSchema,
} from "@kitchen-ops/shared";
import type { ModelConfig } from "./config";
import type { ChatReply, OpenRouterClient } from "./openrouter";
import type { Prompt } from "./prompts";

// One extraction (spec section 5, stage 3): ask the model, validate with the Zod schema, retry
// once with the validation errors, then send to review. Output is never repaired by guessing.

/** Where a document comes from. Client documents only go to providers that keep nothing. */
export type DocumentSource = "own-or-public" | "client";

/**
 * OpenRouter's provider routing for client documents (decision 0007): "use only providers which
 * do not collect user data", and "only ... endpoints that have a Zero Data Retention policy".
 */
export const CLIENT_ROUTING = { data_collection: "deny", zdr: true } as const;

/** Part of the document, as OpenRouter's chat messages take it: text, or an image (#48). */
export type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image_url";
      readonly image_url: { readonly url: string };
    };

export interface ExtractionRequest {
  readonly model: ModelConfig;
  readonly prompt: Prompt;
  readonly content: readonly ContentPart[];
  /** Required, with no default: a client document can't be sent without restricted routing. */
  readonly source: DocumentSource;
}

/** What one extraction cost and how it went, for the eval. */
export interface CallRecord {
  readonly model: string;
  readonly promptVersion: string;
  readonly attempts: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Millionths of a US dollar, summed over the attempts; null if OpenRouter didn't report a cost. */
  readonly costMicroUsd: number | null;
  readonly latencyMs: number;
  /** Structured output was requested and the first answer still didn't match the schema. */
  readonly structuredOutputFailed: boolean;
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
      readonly record: CallRecord;
    };

type Parsed =
  { ok: true; document: ExtractedDocument } | { ok: false; issues: string[] };

/** A ```json fence around the answer is removed: that changes no value. */
const FENCE = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/;

function parse(content: string | null): Parsed {
  if (content === null || content.trim() === "") {
    return { ok: false, issues: ["the reply was empty"] };
  }
  const json = FENCE.exec(content)?.[1] ?? content;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, issues: ["the reply isn't JSON"] };
  }
  const result = ExtractedDocument.safeParse(value);
  return result.success
    ? { ok: true, document: result.data }
    : {
        ok: false,
        issues: result.error.issues.map(
          (issue) =>
            `${issue.path.join(".") || "(the whole object)"}: ${issue.message}`,
        ),
      };
}

function retryMessage(issues: readonly string[]): string {
  return [
    "That answer doesn't match the schema:",
    ...issues.map((issue) => `- ${issue}`),
    "Reply again with the whole corrected JSON object. Use null for anything not printed or unreadable; don't guess.",
  ].join("\n");
}

export async function extractDocument(
  client: OpenRouterClient,
  request: ExtractionRequest,
  { now = () => performance.now() }: { now?: () => number } = {},
): Promise<ExtractionResult> {
  const { model, prompt, content, source } = request;
  const schema = extractedDocumentJsonSchema();

  const system = model.structuredOutput
    ? prompt.text
    : `${prompt.text}\n\nReturn only a JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}`;
  const provider = {
    ...(model.structuredOutput ? { require_parameters: true } : {}),
    ...(source === "client" ? CLIENT_ROUTING : {}),
  };
  const body = (messages: readonly unknown[]) => ({
    model: model.id,
    messages,
    ...(model.temperature !== undefined
      ? { temperature: model.temperature }
      : {}),
    ...(model.structuredOutput
      ? {
          response_format: {
            type: "json_schema",
            json_schema: { name: "extracted_document", strict: true, schema },
          },
        }
      : {}),
    ...(Object.keys(provider).length > 0 ? { provider } : {}),
  });

  const started = now();
  const replies: ChatReply[] = [];
  let attempts = 0;
  let structuredOutputFailed = false;
  const record = (): CallRecord => ({
    model: model.id,
    promptVersion: prompt.version,
    attempts,
    promptTokens: replies.reduce((sum, r) => sum + (r.promptTokens ?? 0), 0),
    completionTokens: replies.reduce(
      (sum, r) => sum + (r.completionTokens ?? 0),
      0,
    ),
    costMicroUsd: replies.some((r) => r.cost === null)
      ? null
      : replies.reduce(
          (sum, r) => sum + Math.round((r.cost ?? 0) * 1_000_000),
          0,
        ),
    latencyMs: Math.round(now() - started),
    structuredOutputFailed,
  });

  const messages: unknown[] = [
    { role: "system", content: system },
    { role: "user", content },
  ];
  let parsed: Parsed = { ok: false, issues: [] };
  for (const attempt of [1, 2]) {
    attempts = attempt;
    let reply: ChatReply;
    try {
      reply = await client.complete(body(messages));
    } catch (error) {
      // HTTP and provider errors aren't retried: the single retry is for invalid output.
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        record: record(),
      };
    }
    replies.push(reply);
    parsed = parse(reply.content);
    if (parsed.ok) {
      return {
        status: "extracted",
        document: parsed.document,
        record: record(),
      };
    }
    if (attempt === 1) {
      structuredOutputFailed = model.structuredOutput;
      messages.push(
        { role: "assistant", content: reply.content ?? "" },
        { role: "user", content: retryMessage(parsed.issues) },
      );
    }
  }
  return {
    status: "needs-review",
    reason: "the output was invalid twice",
    issues: parsed.ok ? [] : parsed.issues,
    record: record(),
  };
}
