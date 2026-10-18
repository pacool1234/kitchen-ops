import type { ModelConfig } from "../llm/config";
import { HEADER_FIELDS, LINE_FIELDS } from "./compare";
import type { Ratio } from "./metrics";
import type { ModelRun } from "./run";
import type { SetName } from "./sets";

// What a run leaves behind (spec section 5): a results file with everything the numbers came
// from, and a Markdown summary that reports the silent error rate first. Neither holds a value
// read from a private document: private runs keep none.

export interface RunInfo {
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly set: SetName;
  readonly prompt: string;
  readonly maxMicroUsd: number;
}

/** The summary's sections, in the order the spec and #50 give. */
export const SUMMARY_SECTIONS = [
  "Silent error rate",
  "Review rate",
  "Header field accuracy",
  "Line precision and recall",
  "Line field accuracy",
  "Cost per document",
  "Latency",
  "Structured-output failure rate",
] as const;

/** `<date>-<model>-<prompt>`, the model ID in lower case with punctuation as hyphens. */
export function resultsFileName(info: RunInfo, model: ModelConfig): string {
  const slug = model.id
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${info.date}-${slug}-${info.prompt}`;
}

/** Dollars from millionths, exactly: no rounding. */
export function formatUsd(microUsd: number): string {
  const whole = Math.floor(microUsd / 1_000_000);
  const fraction = String(microUsd % 1_000_000).padStart(6, "0");
  return `$${whole}.${fraction}`;
}

export function formatRatio({ part, whole }: Ratio): string {
  if (whole === 0) return `${part} of ${whole}`;
  return `${part} of ${whole} (${((part * 100) / whole).toFixed(1)}%)`;
}

function table(rows: readonly (readonly [string, string])[]): string[] {
  return [
    "| Field | Right |",
    "| --- | --- |",
    ...rows.map(([field, value]) => `| ${field} | ${value} |`),
  ];
}

function stopNotice(run: ModelRun, info: RunInfo): string {
  const ran = run.documents.length;
  const total = ran + run.notRun.length;
  switch (run.stoppedBecause) {
    case null:
      return `${ran} of ${total} documents run. Spending cap ${formatUsd(info.maxMicroUsd)}.`;
    case "spending-cap":
      return `**Stopped at the spending cap of ${formatUsd(info.maxMicroUsd)}: ${ran} of ${total} documents run.** The results file lists the rest.`;
    case "unknown-cost":
      return `**Stopped: a call's cost wasn't reported, so the spending cap couldn't be kept. ${ran} of ${total} documents run.** The results file lists the rest.`;
  }
}

export function summaryMarkdown(run: ModelRun, info: RunInfo): string {
  const { summary } = run;
  const compared = summary.headerAccuracy.documentType.whole;
  const reasons = new Map<string, number>();
  for (const document of run.documents) {
    if (document.reviewBecause !== null) {
      reasons.set(
        document.reviewBecause,
        (reasons.get(document.reviewBecause) ?? 0) + 1,
      );
    }
  }
  // Most common first; ties in the order they first happened. Never for the private set, even
  // if a message reached its results: a provider's error could quote the document.
  const failures = new Map<string, number>();
  if (info.set === "gold") {
    for (const { failure } of run.documents) {
      if (failure !== null)
        failures.set(failure, (failures.get(failure) ?? 0) + 1);
    }
  }
  const failureLines =
    failures.size === 0
      ? []
      : [
          "",
          "Why calls failed:",
          "",
          ...[...failures]
            .sort(([, a], [, b]) => b - a)
            .map(([message, n]) => `- ${n} × ${message}`),
        ];
  const cost = summary.cost;
  const costLines = [
    cost.perDocumentMicroUsd === null
      ? "No reported cost."
      : `${formatUsd(cost.perDocumentMicroUsd)} per document, over ${cost.documentsCounted} with a reported cost; ${formatUsd(cost.totalMicroUsd)} in all.`,
    ...(cost.documentsWithUnknownCost > 0
      ? [`${cost.documentsWithUnknownCost} with no reported cost, left out.`]
      : []),
    ...(cost.documentsWithoutCall > 0
      ? [`${cost.documentsWithoutCall} needed no model call.`]
      : []),
  ];
  const latency = summary.latencyMs;

  const sections: Record<(typeof SUMMARY_SECTIONS)[number], string[]> = {
    "Silent error rate": [
      `${formatRatio(summary.silentErrorRate)}: passed validation, but wrong.`,
    ],
    "Review rate": [
      `${formatRatio(summary.reviewRate)}: sent to a person.`,
      ...(reasons.size > 0
        ? [
            `By reason: ${[...reasons].map(([reason, n]) => `${reason} ${n}`).join(", ")}.`,
          ]
        : []),
      ...failureLines,
      "",
      `Correct:${formatRatio({ part: summary.outcomes.correct, whole: summary.documents })}.`,
    ],
    "Header field accuracy": [
      `Over the ${compared} documents that produced a document.`,
      "",
      ...table(
        HEADER_FIELDS.map((field) => [
          field,
          formatRatio(summary.headerAccuracy[field]),
        ]),
      ),
    ],
    "Line precision and recall": [
      `- Precision (lines found that exist): ${formatRatio(summary.linePrecision)}`,
      `- Recall (lines that exist that were found): ${formatRatio(summary.lineRecall)}`,
    ],
    "Line field accuracy": [
      `Over the ${summary.lineRecall.part} matched lines.`,
      "",
      ...table(
        LINE_FIELDS.map((field) => [
          field,
          formatRatio(summary.lineFieldAccuracy[field]),
        ]),
      ),
    ],
    "Cost per document": costLines,
    Latency: [
      latency.p50 === null
        ? "No model calls."
        : `p50 ${latency.p50} ms, p95 ${latency.p95} ms, over ${latency.documentsCounted} calls.`,
    ],
    "Structured-output failure rate": [
      run.structuredOutput === null
        ? "Not requested: the schema went in the prompt."
        : `${formatRatio(run.structuredOutput)} calls: structured output was requested and the first answer didn't match the schema.`,
    ],
  };

  return [
    `# Eval: ${run.model.id}, prompt ${info.prompt}, ${info.set} set, ${info.date}`,
    "",
    stopNotice(run, info),
    ...SUMMARY_SECTIONS.flatMap((section) => [
      "",
      `## ${section}`,
      "",
      ...sections[section],
    ]),
    "",
  ].join("\n");
}

export function resultsJson(run: ModelRun, info: RunInfo) {
  return {
    date: info.date,
    set: info.set,
    prompt: info.prompt,
    model: run.model,
    spendingCapMicroUsd: info.maxMicroUsd,
    stoppedBecause: run.stoppedBecause,
    summary: run.summary,
    structuredOutput: run.structuredOutput,
    documents: run.documents,
    notRun: run.notRun,
  };
}
