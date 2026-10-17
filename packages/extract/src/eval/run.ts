import type { ExtractedDocument } from "@kitchen-ops/shared";
import type { ModelConfig } from "../llm/config";
import type { CallRecord } from "../llm/extract";
import type { OpenRouterClient } from "../llm/openrouter";
import type { Prompt } from "../llm/prompts";
import { extractFile, sha256Hex, type Route } from "../route/route";
import { validate, type CheckName } from "../validation/checks";
import {
  evaluateDocument,
  summarize,
  type DocumentEvaluation,
  type Outcome,
  type Ratio,
  type ReviewReason,
  type RunSummary,
} from "./metrics";
import type { EvalDocument, EvalSet } from "./sets";

// One eval run (spec section 5): every document of a set, for each model, through routing,
// extraction, validation and evaluation, one at a time, stopping at the spending cap.

/** Validation's date check allows this many days before a document's (gold) date. */
const MAX_AGE_DAYS = 365;

export interface RunOptions {
  readonly set: EvalSet;
  readonly models: readonly ModelConfig[];
  readonly prompt: Prompt;
  readonly client: OpenRouterClient;
  /** The run stops once it has spent more than this, in millionths of a US dollar. */
  readonly maxMicroUsd: number;
  /** The run's date, YYYY-MM-DD: validation's "today" for a document whose gold answer has no date. */
  readonly today: string;
  readonly now?: () => number;
  /** Replaced in tests, to run many documents quickly. */
  readonly extract?: typeof extractFile;
}

export type StopReason = "spending-cap" | "unknown-cost";

export interface DocumentResult {
  /** The gold folder name, or for the private set the first 12 characters of the SHA-256. */
  readonly id: string;
  readonly sha256: string;
  readonly route: Route;
  readonly outcome: Outcome;
  readonly reviewBecause: ReviewReason | null;
  readonly validationFailures: readonly CheckName[];
  /** Field paths, never values. */
  readonly differences: readonly string[];
  readonly record: CallRecord | null;
  /** What was read. Always null for the private set. */
  readonly document: ExtractedDocument | null;
}

export interface ModelRun {
  readonly model: ModelConfig;
  readonly documents: readonly DocumentResult[];
  /** Documents the run stopped before, by id. */
  readonly notRun: readonly string[];
  readonly stoppedBecause: StopReason | null;
  readonly summary: RunSummary;
  /** Calls whose first answer didn't match the schema; null if the model doesn't ask for structured output. */
  readonly structuredOutput: Ratio | null;
}

function documentId(set: EvalSet, document: EvalDocument): string {
  return set.name === "private"
    ? sha256Hex(document.source).slice(0, 12)
    : document.id;
}

/**
 * Each document is validated as if it had just arrived: "today" is its gold date, so a date read
 * right always passes and a run's results don't drift with the calendar. Known numbers are empty:
 * no document of a set duplicates another.
 */
function validationFailures(
  read: ExtractedDocument,
  gold: ExtractedDocument,
  today: string,
): CheckName[] {
  const { failures } = validate(read, {
    today: gold.issueDate ?? today,
    maxAgeDays: MAX_AGE_DAYS,
    knownNumbers: [],
  });
  return [...new Set(failures.map((failure) => failure.check))];
}

export async function runEval(options: RunOptions): Promise<ModelRun[]> {
  const { set, prompt, client, maxMicroUsd, today, now } = options;
  const extract = options.extract ?? extractFile;
  let spent = 0;
  let stopped: StopReason | null = null;

  const runs: ModelRun[] = [];
  for (const model of options.models) {
    const documents: DocumentResult[] = [];
    const evaluations: DocumentEvaluation[] = [];
    const notRun: string[] = [];
    for (const document of set.documents) {
      if (stopped === null && spent > maxMicroUsd) stopped = "spending-cap";
      if (stopped !== null) {
        notRun.push(documentId(set, document));
        continue;
      }
      const extraction = await extract(
        client,
        document.source,
        { model, prompt, source: set.source },
        now ? { now } : {},
      );
      const { result } = extraction;
      const failures =
        result.status === "extracted"
          ? validationFailures(result.document, document.gold, today)
          : [];
      const evaluation = evaluateDocument({
        gold: document.gold,
        result,
        validationFailures: failures,
      });
      evaluations.push(evaluation);
      documents.push({
        id: documentId(set, document),
        sha256: extraction.sha256,
        route: extraction.route,
        outcome: evaluation.outcome,
        reviewBecause: evaluation.reviewBecause,
        validationFailures: failures,
        differences: evaluation.comparison?.differences ?? [],
        record: result.record,
        document:
          set.name === "gold" && result.status === "extracted"
            ? result.document
            : null,
      });
      if (result.record !== null) {
        if (result.record.costMicroUsd === null) stopped = "unknown-cost";
        else spent += result.record.costMicroUsd;
      }
    }
    const records = documents.flatMap((d) =>
      d.record === null ? [] : [d.record],
    );
    runs.push({
      model,
      documents,
      notRun,
      stoppedBecause: notRun.length > 0 ? stopped : null,
      summary: summarize(evaluations),
      structuredOutput: model.structuredOutput
        ? {
            part: records.filter((r) => r.structuredOutputFailed).length,
            whole: records.length,
          }
        : null,
    });
  }
  return runs;
}
