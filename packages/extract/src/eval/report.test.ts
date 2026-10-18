import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ModelConfig } from "../llm/config";
import type { ChatReply } from "../llm/openrouter";
import {
  formatRatio,
  formatUsd,
  resultsFileName,
  resultsJson,
  summaryMarkdown,
  SUMMARY_SECTIONS,
  type RunInfo,
} from "./report";
import { runEval, type ModelRun } from "./run";
import { loadSet } from "./sets";

const goldSet = loadSet("gold", {});
const textPdf = goldSet.documents.find(
  (d) => d.id === "syn-002-invoice-discounts-two-vat",
)!;
const facturae = goldSet.documents.find((d) => d.id === "syn-006-facturae")!;

const model: ModelConfig = {
  id: "vendor/model-name",
  structuredOutput: true,
  vision: true,
};
const info: RunInfo = {
  date: "2026-10-18",
  set: "gold",
  prompt: "v1",
  maxMicroUsd: 1_000_000,
};

async function run(
  overrides: { maxMicroUsd?: number } = {},
): Promise<ModelRun> {
  const answer: ChatReply = {
    content: JSON.stringify({ ...textPdf.gold, number: "F-9" }),
    promptTokens: 1000,
    completionTokens: 200,
    cost: 0.0012,
  };
  const [result] = await runEval({
    set: { ...goldSet, documents: [facturae, textPdf, textPdf] },
    models: [model],
    prompt: { version: "v1", text: "Extract the document." },
    client: { complete: async () => answer },
    maxMicroUsd: overrides.maxMicroUsd ?? 1_000_000,
    today: "2026-10-18",
  });
  return result!;
}

describe("resultsFileName: <date>-<model>-<prompt>", () => {
  it("a model ID's slash and other punctuation become hyphens", () => {
    expect(resultsFileName(info, model)).toBe(
      "2026-10-18-vendor-model-name-v1",
    );
    expect(
      resultsFileName(info, { ...model, id: "Vendor/Model_2.5:free" }),
    ).toBe("2026-10-18-vendor-model_2.5-free-v1");
  });
});

describe("formatting", () => {
  it("money in dollars, exactly, from millionths", () => {
    expect(formatUsd(1200)).toBe("$0.001200");
    expect(formatUsd(1_000_000)).toBe("$1.000000");
    expect(formatUsd(12_345_678)).toBe("$12.345678");
  });

  it("a ratio as counts and a percentage; no percentage when there is nothing to count", () => {
    expect(formatRatio({ part: 1, whole: 6 })).toBe("1 of 6 (16.7%)");
    expect(formatRatio({ part: 0, whole: 0 })).toBe("0 of 0");
  });
});

describe("summaryMarkdown: the report, silent error rate first", () => {
  it("has every section, in the order the spec and issue give", async () => {
    const summary = summaryMarkdown(await run(), info);
    const positions = SUMMARY_SECTIONS.map((section) =>
      summary.indexOf(`## ${section}`),
    );
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(SUMMARY_SECTIONS).toEqual([
      "Silent error rate",
      "Review rate",
      "Header field accuracy",
      "Line precision and recall",
      "Line field accuracy",
      "Cost per document",
      "Latency",
      "Structured-output failure rate",
    ]);
  });

  it("names the model, prompt, set and date, and the counts", async () => {
    const summary = summaryMarkdown(await run(), info);
    expect(summary).toContain("vendor/model-name");
    expect(summary).toContain("prompt v1");
    expect(summary).toContain("gold set");
    expect(summary).toContain("2026-10-18");
    // The Facturae invoice right, then the two text PDFs read with a wrong number.
    expect(summary).toContain("2 of 3 (66.7%)");
  });

  it("says when the run stopped at the spending cap, and how many documents it didn't run", async () => {
    const stopped = await run({ maxMicroUsd: 1000 });
    const summary = summaryMarkdown(stopped, { ...info, maxMicroUsd: 1000 });
    expect(summary).toContain(
      "Stopped at the spending cap of $0.001000: 2 of 3 documents run",
    );
  });

  it("a model that doesn't ask for structured output says so instead of a rate", async () => {
    const result = await run();
    const summary = summaryMarkdown(
      { ...result, structuredOutput: null },
      info,
    );
    expect(summary).toContain("Not requested: the schema went in the prompt.");
  });
});

const refused =
  "OpenRouter answered 400: Provider returned error. Azure said: Schemas contains too many parameters";
const timedOut = "OpenRouter answered 504: Gateway timeout";

/** The run's documents, each failed with the message given, or not failed for null. */
function withFailures(
  base: ModelRun,
  failures: readonly (string | null)[],
): ModelRun {
  const document = base.documents[1]!;
  return {
    ...base,
    documents: failures.map((failure) => ({
      ...document,
      failure,
      reviewBecause: failure === null ? document.reviewBecause : "failed",
    })),
  };
}

/** The "Why calls failed" list, as [count, message] pairs. */
function failureList(summary: string): [number, string][] {
  return [...summary.matchAll(/^- (\d+) × (.*)$/gm)].map((m) => [
    Number(m[1]),
    m[2]!,
  ]);
}

describe("summaryMarkdown: why calls failed (#64)", () => {
  it("lists each distinct message under Review rate with its count, most common first", async () => {
    const summary = summaryMarkdown(
      withFailures(await run(), [timedOut, refused, null, refused]),
      info,
    );
    const review = summary.slice(
      summary.indexOf("## Review rate"),
      summary.indexOf("## Header field accuracy"),
    );
    expect(review).toContain("Why calls failed:");
    expect(failureList(review)).toEqual([
      [2, refused],
      [1, timedOut],
    ]);
  });

  it("has no list when no call failed", async () => {
    const summary = summaryMarkdown(await run(), info);
    expect(summary).not.toContain("Why calls failed");
  });

  it("a private run's summary holds no failure message, even if one reached its results", async () => {
    const summary = summaryMarkdown(
      withFailures(await run(), [refused, refused]),
      { ...info, set: "private" },
    );
    expect(summary).not.toContain("Why calls failed");
    expect(summary).not.toContain("Schemas contains");
  });

  it("a private run, end to end, holds no failure message in its summary or results", async () => {
    const [result] = await runEval({
      set: {
        ...goldSet,
        name: "private",
        source: "client",
        documents: [textPdf],
      },
      models: [model],
      prompt: { version: "v1", text: "Extract the document." },
      client: {
        complete: async () => {
          throw new Error(refused);
        },
      },
      maxMicroUsd: 1_000_000,
      today: "2026-10-18",
    });
    const privateInfo: RunInfo = { ...info, set: "private" };
    expect(result!.documents[0]!.reviewBecause).toBe("failed");
    expect(summaryMarkdown(result!, privateInfo)).not.toContain(
      "Schemas contains",
    );
    expect(JSON.stringify(resultsJson(result!, privateInfo))).not.toContain(
      "Schemas contains",
    );
  });

  it("for any mix of failed and successful documents, the counts add up to the failed documents", async () => {
    const base = await run();
    await fc.assert(
      fc.property(
        fc.array(fc.constantFrom(null, refused, timedOut, "fetch failed"), {
          maxLength: 30,
        }),
        (failures) => {
          const list = failureList(
            summaryMarkdown(withFailures(base, failures), info),
          );
          const failed = failures.filter((f) => f !== null);
          expect(list.reduce((sum, [n]) => sum + n, 0)).toBe(failed.length);
          expect(new Set(list.map(([, m]) => m))).toEqual(new Set(failed));
          const counts = list.map(([n]) => n);
          expect(counts).toEqual([...counts].sort((a, b) => b - a));
        },
      ),
    );
  });
});

describe("resultsJson: everything the summary came from", () => {
  it("the run's details, summary, documents and the documents not run", async () => {
    const result = await run({ maxMicroUsd: 1000 });
    const json = JSON.parse(
      JSON.stringify(resultsJson(result, { ...info, maxMicroUsd: 1000 })),
    );
    expect(json).toMatchObject({
      date: "2026-10-18",
      set: "gold",
      prompt: "v1",
      model: { id: "vendor/model-name", structuredOutput: true, vision: true },
      spendingCapMicroUsd: 1000,
      stoppedBecause: "spending-cap",
      notRun: [textPdf.id],
    });
    expect(json.summary.documents).toBe(2);
    expect(json.documents[1]).toMatchObject({
      id: textPdf.id,
      route: "pdf-text",
      outcome: "silent-error",
      differences: ["number"],
    });
  });
});
