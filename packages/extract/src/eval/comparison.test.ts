import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  acrossRuns,
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
    .split("\n## ")[0]!
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
      "| vendor/good | v1 | default | 1 | 20 of 20 | 0 of 20 (0.0%) ✓ | 0 of 20 (0.0%) ✓ | 20 | $2.000000 | $0.100000 |",
      "| vendor/poor | v1 | default | 1 | 20 of 20 | 1 of 20 (5.0%) ✗ | 4 of 20 (20.0%) ✗ | 15 | $0.030000 | $0.002000 |",
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
      "| vendor/a | v1 | default | 1 | 1 of 3 (stopped: spending-cap) | 0 of 1 (0.0%) ✓ | 1 of 1 (100.0%) ✗ | 0 | $0.005000 | none correct |",
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

/** `n` correct documents, then the given ones. */
const documentsWith = (n: number, ...others: Document[]) => [
  ...others,
  ...Array.from({ length: n }, (_, i) => correct(`d${i}`)),
];
const wrong = (id: string): Document => ({
  ...correct(id),
  outcome: "silent-error",
  differences: ["number"],
});
const toReview = (id: string): Document => ({
  ...correct(id),
  outcome: "review",
  reviewBecause: "validation",
  validationFailures: ["line-total"],
});
/** A run of `model` at temperature 0, run number `run`. */
const repeat = (model: string, run: number, documents: Document[]) =>
  results(model, documents, 10_000, {
    run,
    model: { id: model, temperature: 0 },
  });

describe("acrossRuns: each model, prompt and temperature over its runs (#68)", () => {
  it("totals over the runs, and the lowest and highest of a single run", () => {
    const [luna] = acrossRuns([
      repeat("vendor/a", 1, documentsWith(19, toReview("x"))),
      repeat("vendor/a", 2, documentsWith(18, wrong("y"), toReview("x"))),
      repeat(
        "vendor/a",
        3,
        documentsWith(17, wrong("y"), wrong("z"), toReview("x")),
      ),
    ]);
    expect(luna).toMatchObject({
      model: "vendor/a",
      prompt: "v1",
      temperature: 0,
      runs: [1, 2, 3],
      silentErrors: { total: { part: 3, whole: 60 }, lowest: 0, highest: 2 },
      review: { total: { part: 3, whole: 60 }, lowest: 1, highest: 1 },
      correct: { total: { part: 54, whole: 60 }, lowest: 17, highest: 19 },
      totalMicroUsd: 30_000,
    });
  });

  it("names the documents whose outcome changed between runs, with how often each outcome came", () => {
    const [luna] = acrossRuns([
      repeat("vendor/a", 1, documentsWith(2, correct("y"), toReview("x"))),
      repeat("vendor/a", 2, documentsWith(2, wrong("y"), toReview("x"))),
      repeat("vendor/a", 3, documentsWith(2, wrong("y"), toReview("x"))),
    ]);
    expect(luna!.changed).toEqual([
      [
        "y",
        [
          ["silent-error", 2],
          ["correct", 1],
        ],
      ],
    ]);
  });

  it("a different model, prompt or temperature is a different combination; old files read as run 1", () => {
    const old = results("vendor/a", [correct("a")]);
    expect(old.run).toBe(1);
    const combinations = acrossRuns([
      old,
      repeat("vendor/a", 1, [correct("a")]),
      repeat("vendor/a", 2, [correct("a")]),
      { ...repeat("vendor/a", 3, [correct("a")]), prompt: "v2" },
      repeat("vendor/b", 1, [correct("a")]),
    ]);
    expect(
      combinations.map((c) => [c.model, c.prompt, c.temperature, c.runs]),
    ).toEqual([
      ["vendor/a", "v1", null, [1]],
      ["vendor/a", "v1", 0, [1, 2]],
      ["vendor/a", "v2", 0, [3]],
      ["vendor/b", "v1", 0, [1]],
    ]);
  });
});

describe("comparisonMarkdown: across runs (#68)", () => {
  it("each run's row names its temperature and run number", () => {
    expect(
      rows(comparisonMarkdown([repeat("vendor/a", 2, [correct("a")])]))[0],
    ).toMatch(/^\| vendor\/a \| v1 \| 0 \| 2 \| 1 of 1 \|/);
  });

  it("a section for the combinations with more than one run: totals, ranges, and what changed", () => {
    const markdown = comparisonMarkdown([
      repeat("vendor/a", 1, documentsWith(19, correct("y"))),
      repeat("vendor/a", 2, documentsWith(19, wrong("y"))),
      repeat("vendor/b", 1, documentsWith(20)),
    ]);
    const section = markdown.split("## Across runs")[1]!.split("\n## ")[0]!;
    expect(section).toContain(
      "| vendor/a | v1 | 0 | 2 | 1 of 40 (2.5%), 0–1 per run | 0 of 40 (0.0%), 0–0 per run | 39 of 40 (97.5%), 19–20 per run | $0.020000 |",
    );
    expect(section).not.toContain("vendor/b");
    expect(section).toContain("### vendor/a, prompt v1, temperature 0");
    expect(section).toContain("- y: correct 1, silent-error 1.");
  });

  it("says so when no document changed between runs", () => {
    const markdown = comparisonMarkdown([
      repeat("vendor/a", 1, documentsWith(3)),
      repeat("vendor/a", 2, documentsWith(3)),
    ]);
    expect(markdown.split("## Across runs")[1]).toContain(
      "No document changed outcome between runs.",
    );
  });

  it("no section when every combination has a single run", () => {
    const markdown = comparisonMarkdown([
      results("vendor/a", [correct("a")]),
      results("vendor/b", [correct("a")]),
    ]);
    expect(markdown).not.toContain("## Across runs");
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

/** Runs of a few models, prompts and temperatures, so that some share a combination. */
const anyRepeat = fc
  .tuple(
    fc.constantFrom("vendor/a", "vendor/b"),
    fc.constantFrom("v1", "v2"),
    fc.constantFrom(undefined, 0, 0.7),
    fc.integer({ min: 1, max: 5 }),
    fc.array(anyDocument, { maxLength: 25 }),
    fc.nat({ max: 5_000_000 }),
  )
  .map(([model, prompt, temperature, run, documents, cost]) =>
    results(model, documents, cost, {
      prompt,
      run,
      model: {
        id: model,
        ...(temperature === undefined ? {} : { temperature }),
      },
    }),
  );

describe("acrossRuns: properties (#68)", () => {
  it("any runs: each in exactly one combination, every total the sum of its runs, every run within its range", () => {
    fc.assert(
      fc.property(fc.array(anyRepeat, { maxLength: 10 }), (runs) => {
        const combinations = acrossRuns(runs);
        expect(combinations.reduce((n, c) => n + c.runs.length, 0)).toBe(
          runs.length,
        );
        const keys = combinations.map(
          (c) => `${c.model} ${c.prompt} ${c.temperature}`,
        );
        expect(new Set(keys).size).toBe(keys.length);
        for (const c of combinations) {
          const own = runs.filter(
            (r) =>
              r.model.id === c.model &&
              r.prompt === c.prompt &&
              (r.model.temperature ?? null) === c.temperature,
          );
          expect(own.map((r) => r.run)).toEqual(c.runs);
          const check = (
            stat: {
              total: { part: number; whole: number };
              lowest: number;
              highest: number;
            },
            count: (r: Results) => number,
          ) => {
            expect(stat.total.part).toBe(own.reduce((n, r) => n + count(r), 0));
            expect(stat.total.whole).toBe(
              own.reduce((n, r) => n + r.summary.documents, 0),
            );
            for (const r of own) {
              expect(count(r)).toBeGreaterThanOrEqual(stat.lowest);
              expect(count(r)).toBeLessThanOrEqual(stat.highest);
            }
            expect(own.map(count)).toContain(stat.lowest);
            expect(own.map(count)).toContain(stat.highest);
          };
          check(c.silentErrors, (r) => r.summary.outcomes["silent-error"]);
          check(c.review, (r) => r.summary.outcomes.review);
          check(c.correct, (r) => r.summary.outcomes.correct);
          expect(c.totalMicroUsd).toBe(
            own.reduce((n, r) => n + r.summary.cost.totalMicroUsd, 0),
          );
        }
      }),
    );
  });
});

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
