import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  comparisonMarkdown,
  failureModes,
  fieldName,
  ResultsFile,
  type ResultsFile as Results,
} from "./comparison";

type Document = Results["documents"][number];

const correct = (id: string): Document => ({
  id,
  outcome: "correct",
  reviewBecause: null,
  validationFailures: [],
  differences: [],
});

/** A results file as the eval command writes it, with only what the comparison reads changed. */
function results(
  model: string,
  documents: Document[],
  totalMicroUsd = 20_000,
  extra: Partial<Results> = {},
): Results {
  const count = (outcome: Document["outcome"]) =>
    documents.filter((d) => d.outcome === outcome).length;
  return ResultsFile.parse({
    date: "2026-10-18",
    set: "gold",
    prompt: "v1",
    model: { id: model, structuredOutput: true, vision: true },
    spendingCapMicroUsd: 1_000_000,
    stoppedBecause: null,
    summary: {
      documents: documents.length,
      outcomes: {
        correct: count("correct"),
        "silent-error": count("silent-error"),
        review: count("review"),
      },
      silentErrorRate: { part: count("silent-error"), whole: documents.length },
      reviewRate: { part: count("review"), whole: documents.length },
      cost: {
        totalMicroUsd,
        perDocumentMicroUsd: 1000,
        documentsCounted: documents.length,
        documentsWithUnknownCost: 0,
        documentsWithoutCall: 0,
      },
    },
    structuredOutput: null,
    documents,
    notRun: [],
    ...extra,
  });
}

/** The comparison table's rows, without the header and separator. */
const rows = (markdown: string) =>
  markdown
    .split("## Failure modes")[0]!
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2);

describe("fieldName: a difference without its line number", () => {
  it("lines are counted together, whichever line it was", () => {
    expect(fieldName("lines.2.quantity")).toBe("lines.*.quantity");
    expect(fieldName("lines.14: not found")).toBe("lines.*: not found");
    expect(fieldName("result line 3: not in the gold answer")).toBe(
      "result line *: not in the gold answer",
    );
    expect(fieldName("number")).toBe("number");
  });
});

describe("failureModes: what went wrong in a run, most common first", () => {
  it("counts wrong fields across documents, validation checks and review reasons", () => {
    const run = results("vendor/a", [
      {
        ...correct("a"),
        outcome: "silent-error",
        differences: ["number", "lines.2.unitPrice"],
      },
      {
        ...correct("b"),
        outcome: "review",
        reviewBecause: "validation",
        validationFailures: ["line-total", "total"],
        differences: ["lines.0.unitPrice"],
      },
      { ...correct("c"), outcome: "review", reviewBecause: "failed" },
      correct("d"),
    ]);
    expect(failureModes(run)).toEqual({
      fields: [
        ["lines.*.unitPrice", 2],
        ["number", 1],
      ],
      checks: [
        ["line-total", 1],
        ["total", 1],
      ],
      reviewReasons: [
        ["failed", 1],
        ["validation", 1],
      ],
    });
  });
});

describe("comparisonMarkdown: the runs side by side", () => {
  it("one row per run: silent errors and review against the targets, cost in dollars", () => {
    const good = results(
      "vendor/good",
      Array.from({ length: 20 }, (_, i) => correct(`d${i}`)),
      2_000_000,
    );
    const poor = results(
      "vendor/poor",
      [
        { ...correct("a"), outcome: "silent-error", differences: ["number"] },
        ...Array.from({ length: 4 }, (_, i) => ({
          ...correct(`r${i}`),
          outcome: "review" as const,
          reviewBecause: "validation" as const,
        })),
        ...Array.from({ length: 15 }, (_, i) => correct(`d${i}`)),
      ],
      30_000,
    );
    expect(rows(comparisonMarkdown([good, poor]))).toEqual([
      "| vendor/good | v1 | 20 of 20 | 0 of 20 (0.0%) ✓ | 0 of 20 (0.0%) ✓ | 20 | $2.000000 | $0.100000 |",
      "| vendor/poor | v1 | 20 of 20 | 1 of 20 (5.0%) ✗ | 4 of 20 (20.0%) ✗ | 15 | $0.030000 | $0.002000 |",
    ]);
  });

  it("states the targets and that money is in US dollars, as OpenRouter bills", () => {
    const markdown = comparisonMarkdown([results("vendor/a", [correct("a")])]);
    expect(markdown).toContain("silent errors below 1%, review below 20%");
    expect(markdown).toContain("US dollars");
  });

  it("a run that stopped early says so, and one with no correct document has no cost per correct document", () => {
    const stopped = results(
      "vendor/a",
      [{ ...correct("a"), outcome: "review", reviewBecause: "failed" }],
      5000,
      { stoppedBecause: "spending-cap", notRun: ["b", "c"] },
    );
    expect(rows(comparisonMarkdown([stopped]))).toEqual([
      "| vendor/a | v1 | 1 of 3 (stopped: spending-cap) | 0 of 1 (0.0%) ✓ | 1 of 1 (100.0%) ✗ | 0 | $0.005000 | none correct |",
    ]);
  });

  it("lists each run's failure modes, or says there were none", () => {
    const markdown = comparisonMarkdown([
      results("vendor/a", [
        {
          ...correct("a"),
          outcome: "silent-error",
          differences: ["lines.1.quantity", "lines.3.quantity"],
        },
      ]),
      results("vendor/b", [correct("a")]),
    ]);
    const failures = markdown.split("## Failure modes")[1]!;
    expect(failures).toContain("### vendor/a, prompt v1");
    expect(failures).toContain("- Fields wrong: lines.*.quantity 2.");
    expect(failures).toContain("### vendor/b, prompt v1");
    expect(failures).toContain("None.");
  });
});

describe("ResultsFile: results files are read from disk, so they're checked", () => {
  it("a file without a summary is refused, naming the field", () => {
    const noSummary = {
      ...results("vendor/a", [correct("a")]),
      summary: undefined,
    };
    expect(ResultsFile.safeParse(noSummary).error?.issues[0]?.path).toEqual([
      "summary",
    ]);
  });
});

const anyDocument = fc.record({
  id: fc.string(),
  outcome: fc.constantFrom("correct", "silent-error", "review"),
  reviewBecause: fc.constantFrom(null, "validation", "failed"),
  validationFailures: fc.array(fc.constantFrom("total", "vat", "line-total")),
  differences: fc.array(
    fc.oneof(
      fc.constantFrom("number", "issueDate", "supplier.taxId"),
      fc
        .tuple(fc.nat({ max: 60 }), fc.constantFrom("quantity", "unitPrice"))
        .map(([line, field]) => `lines.${line}.${field}`),
      fc.nat({ max: 60 }).map((line) => `lines.${line}: not found`),
    ),
  ),
}) satisfies fc.Arbitrary<Document>;

const anyRun = fc
  .tuple(
    fc.stringMatching(/^[a-z]+\/[a-z0-9.-]+$/),
    fc.array(anyDocument, { maxLength: 25 }),
    fc.nat({ max: 5_000_000 }),
  )
  .map(([model, documents, cost]) => results(model, documents, cost));

describe("comparison: properties", () => {
  it("any runs: one row each, in the order given", () => {
    fc.assert(
      fc.property(fc.array(anyRun, { maxLength: 6 }), (runs) => {
        const table = rows(comparisonMarkdown(runs));
        expect(table).toHaveLength(runs.length);
        table.forEach((row, i) =>
          expect(row.startsWith(`| ${runs[i]!.model.id} |`)).toBe(true),
        );
      }),
    );
  });

  it("the failure counts add up to the run's differences, validation failures and documents sent to review", () => {
    fc.assert(
      fc.property(anyRun, (run) => {
        const modes = failureModes(run);
        const total = (counts: [string, number][]) =>
          counts.reduce((sum, [, n]) => sum + n, 0);
        const all = (pick: (d: Document) => readonly string[]) =>
          run.documents.flatMap(pick).length;
        expect(total(modes.fields)).toBe(all((d) => d.differences));
        expect(total(modes.checks)).toBe(all((d) => d.validationFailures));
        expect(total(modes.reviewReasons)).toBe(
          run.documents.filter((d) => d.reviewBecause !== null).length,
        );
      }),
    );
  });

  it("a field's line number never splits its count: one entry per field, whichever lines it was on", () => {
    fc.assert(
      fc.property(anyRun, (run) => {
        const names = failureModes(run).fields.map(([name]) => name);
        expect(new Set(names).size).toBe(names.length);
        for (const name of names) expect(name).not.toMatch(/\d/);
      }),
    );
  });
});
