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
  /** Files written before #68 have no run number: each was its combination's first run. */
  run: z.number().int().positive().default(1),
  model: z.object({ id: z.string(), temperature: z.number().optional() }),
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

/** A count over several runs: the total, and the lowest and highest of a single run. */
export interface Spread {
  readonly total: { readonly part: number; readonly whole: number };
  readonly lowest: number;
  readonly highest: number;
}

/** One model, prompt and temperature, over all its runs given (#68). */
export interface Combination {
  readonly model: string;
  readonly prompt: string;
  /** null: no temperature was sent, so the provider's default applied. */
  readonly temperature: number | null;
  /** Run numbers, in the order given. */
  readonly runs: readonly number[];
  readonly silentErrors: Spread;
  readonly review: Spread;
  readonly correct: Spread;
  readonly totalMicroUsd: number;
  /** Documents whose outcome wasn't the same in every run, with how often each outcome came. */
  readonly changed: readonly [string, [string, number][]][];
}

function spread(
  runs: readonly ResultsFile[],
  count: (run: ResultsFile) => number,
): Spread {
  const counts = runs.map(count);
  return {
    total: {
      part: counts.reduce((sum, n) => sum + n, 0),
      whole: runs.reduce((sum, run) => sum + run.summary.documents, 0),
    },
    lowest: Math.min(...counts),
    highest: Math.max(...counts),
  };
}

/** The runs grouped by model, prompt and temperature, in the order each combination first came. */
export function acrossRuns(runs: readonly ResultsFile[]): Combination[] {
  const groups = new Map<string, ResultsFile[]>();
  for (const run of runs) {
    const key = JSON.stringify([
      run.model.id,
      run.prompt,
      run.model.temperature ?? null,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.values()].map((group) => {
    const [first] = group as [ResultsFile, ...ResultsFile[]];
    const outcomes = new Map<string, string[]>();
    for (const run of group) {
      for (const document of run.documents) {
        outcomes.set(document.id, [
          ...(outcomes.get(document.id) ?? []),
          document.outcome,
        ]);
      }
    }
    return {
      model: first.model.id,
      prompt: first.prompt,
      temperature: first.model.temperature ?? null,
      runs: group.map((run) => run.run),
      silentErrors: spread(
        group,
        (run) => run.summary.outcomes["silent-error"],
      ),
      review: spread(group, (run) => run.summary.outcomes.review),
      correct: spread(group, (run) => run.summary.outcomes.correct),
      totalMicroUsd: group.reduce(
        (sum, run) => sum + run.summary.cost.totalMicroUsd,
        0,
      ),
      changed: [...outcomes]
        .filter(([, seen]) => new Set(seen).size > 1)
        .map(([id, seen]) => [id, counted(seen)]),
    };
  });
}

const temperatureText = (temperature: number | null | undefined) =>
  temperature === null || temperature === undefined
    ? "default"
    : String(temperature);

const spreadText = ({ total, lowest, highest }: Spread) =>
  `${formatRatio(total)}, ${lowest}–${highest} per run`;

function acrossRunsSection(runs: readonly ResultsFile[]): string[] {
  const repeated = acrossRuns(runs).filter((c) => c.runs.length > 1);
  if (repeated.length === 0) return [];
  return [
    "",
    "## Across runs",
    "",
    "Each model, prompt and temperature with more than one run: the total over its runs, then the lowest and highest of a single run.",
    "",
    "| Model | Prompt | Temperature | Runs | Silent errors | Review | Correct | Total cost |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...repeated.map(
      (c) =>
        `| ${[
          c.model,
          c.prompt,
          temperatureText(c.temperature),
          String(c.runs.length),
          spreadText(c.silentErrors),
          spreadText(c.review),
          spreadText(c.correct),
          formatUsd(c.totalMicroUsd),
        ].join(" | ")} |`,
    ),
    ...repeated.flatMap((c) => [
      "",
      `### ${c.model}, prompt ${c.prompt}, temperature ${temperatureText(c.temperature)}`,
      "",
      ...(c.changed.length === 0
        ? ["No document changed outcome between runs."]
        : c.changed.map(([id, seen]) => `- ${id}: ${list(seen)}.`)),
    ]),
  ];
}

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
    temperatureText(run.model.temperature),
    String(run.run),
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
    `### ${run.model.id}, prompt ${run.prompt}${run.model.temperature === undefined ? "" : `, temperature ${run.model.temperature}`}${run.run === 1 ? "" : `, run ${run.run}`}`,
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
    "| Model | Prompt | Temperature | Run | Documents run | Silent errors | Review | Correct | Total cost | Cost per correct document |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...runs.map(row),
    ...acrossRunsSection(runs),
    "",
    "## Failure modes",
    "",
    "Wrong fields count every occurrence, with line numbers dropped: `lines.*.unitPrice 3` is three wrong unit prices, on any lines.",
    ...runs.flatMap(failureSection),
    "",
  ].join("\n");
}
