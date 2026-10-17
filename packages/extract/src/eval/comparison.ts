import { z } from "zod";
import { CHECKS } from "../validation/checks";
import { OUTCOMES } from "./metrics";
import { formatRatio, formatUsd } from "./report";
import { SET_NAMES } from "./sets";

// Several eval runs side by side (#52): silent errors and review against the spec's provisional
// targets (section 5), what each run cost, and what went wrong most often. Reads the results files
// the eval command writes, so it reports only what they hold: counts and field paths, never values.

const Ratio = z.object({
  part: z.number().int().nonnegative(),
  whole: z.number().int().nonnegative(),
});

/** The parts of a results file (`resultsJson`) the comparison reads. Files come from disk. */
export const ResultsFile = z.object({
  date: z.iso.date(),
  set: z.enum(SET_NAMES),
  prompt: z.string(),
  model: z.object({ id: z.string() }),
  stoppedBecause: z.enum(["spending-cap", "unknown-cost"]).nullable(),
  summary: z.object({
    documents: z.number().int().nonnegative(),
    outcomes: z.object({
      correct: z.number().int().nonnegative(),
      "silent-error": z.number().int().nonnegative(),
      review: z.number().int().nonnegative(),
    }),
    silentErrorRate: Ratio,
    reviewRate: Ratio,
    cost: z.object({
      totalMicroUsd: z.number().int().nonnegative(),
      documentsWithUnknownCost: z.number().int().nonnegative(),
    }),
  }),
  documents: z.array(
    z.object({
      id: z.string(),
      outcome: z.enum(OUTCOMES),
      reviewBecause: z
        .enum(["needs-review", "failed", "rejected", "validation"])
        .nullable(),
      validationFailures: z.array(z.enum(CHECKS)),
      differences: z.array(z.string()),
    }),
  ),
  notRun: z.array(z.string()),
});
export type ResultsFile = z.infer<typeof ResultsFile>;

/** Provisional targets (spec section 5), as fractions: silent errors below 1%, review below 20%. */
const TARGETS = {
  silentErrors: { part: 1, whole: 100 },
  review: { part: 20, whole: 100 },
};

/** Whether `rate` is below `target`, compared exactly: a/b < c/d is a·d < c·b. */
const below = (
  rate: { part: number; whole: number },
  target: { part: number; whole: number },
) => rate.part * target.whole < target.part * rate.whole;

function againstTarget(
  rate: { part: number; whole: number },
  target: { part: number; whole: number },
): string {
  if (rate.whole === 0) return formatRatio(rate);
  return `${formatRatio(rate)} ${below(rate, target) ? "✓" : "✗"}`;
}

/** A difference's path without its line number: "lines.2.quantity" is "lines.*.quantity". */
export function fieldName(path: string): string {
  return path.replace(/\d+/g, "*");
}

/** How often each name occurs, most common first, then by name. */
function counted(names: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].sort(([a, m], [b, n]) => n - m || a.localeCompare(b));
}

export interface FailureModes {
  /** Wrong fields, over every document that produced one. */
  readonly fields: [string, number][];
  readonly checks: [string, number][];
  readonly reviewReasons: [string, number][];
}

export function failureModes(run: ResultsFile): FailureModes {
  const { documents } = run;
  return {
    fields: counted(documents.flatMap((d) => d.differences.map(fieldName))),
    checks: counted(documents.flatMap((d) => d.validationFailures)),
    reviewReasons: counted(
      documents.flatMap((d) =>
        d.reviewBecause === null ? [] : [d.reviewBecause],
      ),
    ),
  };
}

const list = (counts: [string, number][]) =>
  counts.map(([name, n]) => `${name} ${n}`).join(", ");

function row(run: ResultsFile): string {
  const { summary } = run;
  const total = run.documents.length + run.notRun.length;
  const stopped =
    run.stoppedBecause === null ? "" : ` (stopped: ${run.stoppedBecause})`;
  const correct = summary.outcomes.correct;
  const unknown = summary.cost.documentsWithUnknownCost;
  const cost = `${formatUsd(summary.cost.totalMicroUsd)}${unknown > 0 ? ` (${unknown} calls with no reported cost left out)` : ""}`;
  const perCorrect =
    correct === 0
      ? "none correct"
      : formatUsd(Math.round(summary.cost.totalMicroUsd / correct));
  return `| ${[
    run.model.id,
    run.prompt,
    `${run.documents.length} of ${total}${stopped}`,
    againstTarget(summary.silentErrorRate, TARGETS.silentErrors),
    againstTarget(summary.reviewRate, TARGETS.review),
    String(correct),
    cost,
    perCorrect,
  ].join(" | ")} |`;
}

function failureSection(run: ResultsFile): string[] {
  const modes = failureModes(run);
  const lines = [
    ...(modes.fields.length > 0
      ? [`- Fields wrong: ${list(modes.fields)}.`]
      : []),
    ...(modes.checks.length > 0
      ? [`- Validation checks failed: ${list(modes.checks)}.`]
      : []),
    ...(modes.reviewReasons.length > 0
      ? [`- Sent to review because: ${list(modes.reviewReasons)}.`]
      : []),
  ];
  return [
    "",
    `### ${run.model.id}, prompt ${run.prompt}`,
    "",
    ...(lines.length > 0 ? lines : ["None."]),
  ];
}

export function comparisonMarkdown(runs: readonly ResultsFile[]): string {
  return [
    "# Eval comparison",
    "",
    "Targets (spec section 5, provisional): silent errors below 1%, review below 20%. Money is in US dollars, as OpenRouter bills and the results files record it.",
    "",
    "| Model | Prompt | Documents run | Silent errors | Review | Correct | Total cost | Cost per correct document |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...runs.map(row),
    "",
    "## Failure modes",
    "",
    "Wrong fields count every occurrence, with line numbers dropped: `lines.*.unitPrice 3` is three wrong unit prices, on any lines.",
    ...runs.flatMap(failureSection),
    "",
  ].join("\n");
}
