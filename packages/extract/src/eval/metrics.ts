import type { ExtractedDocument } from "@kitchen-ops/shared";
import type { CallRecord } from "../llm/extract";
import type { FileResult } from "../route/route";
import type { CheckName } from "../validation/checks";
import {
  compareDocument,
  HEADER_FIELDS,
  LINE_FIELDS,
  type DocumentComparison,
  type HeaderField,
  type LineField,
} from "./compare";

// The metrics an eval run reports (spec section 5), silent error rate first. Rates are kept as
// part/whole counts, so nothing is rounded until the summary is printed. Counts only: no values.

export const OUTCOMES = ["correct", "silent-error", "review"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Why a document went to a person. */
export type ReviewReason =
  "needs-review" | "failed" | "rejected" | "validation";

/** One document of a run: its gold answer, what extraction gave, and the checks it failed. */
export interface DocumentRun {
  readonly gold: ExtractedDocument;
  readonly result: FileResult;
  readonly validationFailures: readonly CheckName[];
}

export interface DocumentEvaluation {
  readonly outcome: Outcome;
  readonly reviewBecause: ReviewReason | null;
  /** null when extraction gave no document. */
  readonly comparison: DocumentComparison | null;
  /** null when no model was called (Facturae, a refused file). */
  readonly record: CallRecord | null;
}

export interface Ratio {
  readonly part: number;
  readonly whole: number;
}

export interface RunSummary {
  readonly documents: number;
  readonly outcomes: Readonly<Record<Outcome, number>>;
  /** Passed validation but wrong: the metric that matters most. */
  readonly silentErrorRate: Ratio;
  readonly reviewRate: Ratio;
  /** Over documents that produced a document. */
  readonly headerAccuracy: Readonly<Record<HeaderField, Ratio>>;
  /** Matched lines over lines found. */
  readonly linePrecision: Ratio;
  /** Matched lines over lines in the gold answers. */
  readonly lineRecall: Ratio;
  /** Over matched lines. */
  readonly lineFieldAccuracy: Readonly<Record<LineField, Ratio>>;
  readonly cost: {
    readonly totalMicroUsd: number;
    /** Over calls with a reported cost; null if there were none. */
    readonly perDocumentMicroUsd: number | null;
    readonly documentsCounted: number;
    /** Calls OpenRouter reported no cost for: left out, never counted as free. */
    readonly documentsWithUnknownCost: number;
    /** No model called. */
    readonly documentsWithoutCall: number;
  };
  readonly latencyMs: {
    readonly p50: number | null;
    readonly p95: number | null;
    readonly documentsCounted: number;
  };
}

export function evaluateDocument(run: DocumentRun): DocumentEvaluation {
  const { result } = run;
  const record = result.record;
  if (result.status !== "extracted") {
    return {
      outcome: "review",
      reviewBecause: result.status,
      comparison: null,
      record,
    };
  }
  const comparison = compareDocument(result.document, run.gold);
  if (run.validationFailures.length > 0) {
    return {
      outcome: "review",
      reviewBecause: "validation",
      comparison,
      record,
    };
  }
  return {
    outcome: comparison.correct ? "correct" : "silent-error",
    reviewBecause: null,
    comparison,
    record,
  };
}

/** Nearest rank: the smallest value with at least p% of the values at or below it. */
export function percentile(
  values: readonly number[],
  p: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p * sorted.length) / 100));
  return sorted[rank - 1] ?? null;
}

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

export function summarize(
  evaluations: readonly DocumentEvaluation[],
): RunSummary {
  const count = (outcome: Outcome) =>
    evaluations.filter((e) => e.outcome === outcome).length;
  const outcomes = {
    correct: count("correct"),
    "silent-error": count("silent-error"),
    review: count("review"),
  };
  const documents = evaluations.length;

  const compared = evaluations.flatMap((e) =>
    e.comparison === null ? [] : [e.comparison],
  );
  const matched = sum(compared.map((c) => c.lines.matched));
  const headerAccuracy = Object.fromEntries(
    HEADER_FIELDS.map((field) => [
      field,
      {
        part: compared.filter((c) => c.header[field]).length,
        whole: compared.length,
      },
    ]),
  ) as Record<HeaderField, Ratio>;
  const lineFieldAccuracy = Object.fromEntries(
    LINE_FIELDS.map((field) => [
      field,
      {
        part: sum(compared.map((c) => c.lines.fieldsRight[field])),
        whole: matched,
      },
    ]),
  ) as Record<LineField, Ratio>;

  const records = evaluations.flatMap((e) =>
    e.record === null ? [] : [e.record],
  );
  const costs = records.flatMap((r) =>
    r.costMicroUsd === null ? [] : [r.costMicroUsd],
  );
  const totalMicroUsd = sum(costs);
  const latencies = records.map((r) => r.latencyMs);

  return {
    documents,
    outcomes,
    silentErrorRate: { part: outcomes["silent-error"], whole: documents },
    reviewRate: { part: outcomes.review, whole: documents },
    headerAccuracy,
    linePrecision: {
      part: matched,
      whole: sum(compared.map((c) => c.lines.result)),
    },
    lineRecall: {
      part: matched,
      whole: sum(compared.map((c) => c.lines.gold)),
    },
    lineFieldAccuracy,
    cost: {
      totalMicroUsd,
      perDocumentMicroUsd:
        costs.length === 0 ? null : Math.round(totalMicroUsd / costs.length),
      documentsCounted: costs.length,
      documentsWithUnknownCost: records.length - costs.length,
      documentsWithoutCall: documents - records.length,
    },
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      documentsCounted: latencies.length,
    },
  };
}
