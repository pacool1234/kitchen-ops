// What the API uses of extraction (#103): reading a document's files, checking what was read,
// the default model and prompt, and the OpenRouter client, whose interface a fake can stand in
// for. The eval stays this package's own command, and isn't exported.

/** A file's kind, from its first bytes (spec section 5, stage 2): uploads are checked with it. */
export { detectFormat, type InputFormat } from "./route/detect";

/** Reading a document: one PDF or Facturae file, or one or several photos, in order. */
export { extractFiles, type DocumentExtraction } from "./route/files";
export type { FileResult, Route } from "./route/route";
export {
  CLIENT_ROUTING,
  type CallRecord,
  type DocumentSource,
  type ExtractionRequest,
  type ExtractionResult,
} from "./llm/extract";

/** Checking what was read (spec section 5, stage 4). */
export {
  CHECKS,
  MAX_AGE_DAYS,
  validate,
  type CheckFailure,
  type CheckName,
  type ValidationContext,
  type ValidationResult,
} from "./validation/checks";

/** Suggesting which of our products each unmatched line is (decision 0036). */
export {
  SUGGESTION_SCHEMA_NAME,
  suggestionContent,
  suggestProducts,
  type CatalogueProduct,
  type SuggestionLine,
  type SuggestionResult,
} from "./llm/suggest";

/** The default model and prompt (decisions 0018, 0036), and the client that calls them. */
export {
  defaultExtraction,
  defaultSuggestion,
  type ModelConfig,
} from "./llm/config";
export type { Prompt } from "./llm/prompts";
export {
  createOpenRouterClient,
  openRouterFromEnv,
  OpenRouterError,
  type ChatReply,
  type OpenRouterClient,
} from "./llm/openrouter";
