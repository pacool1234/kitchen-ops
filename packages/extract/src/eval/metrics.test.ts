import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ExtractedDocument } from "@kitchen-ops/shared";
import type { CallRecord } from "../llm/extract";
import type { FileResult } from "../route/route";
import { CHECKS } from "../validation/checks";
import { HEADER_FIELDS, LINE_FIELDS } from "./compare";
import {
  evaluateDocument,
  percentile,
  summarize,
  type DocumentRun,
} from "./metrics";
import { document } from "./testing";

// A fictional delivery note, as a gold answer.
const gold: ExtractedDocument = {
  documentType: "delivery-note",
  currency: "EUR",
  supplier: { name: "Huerta Ficticia S.L.", taxId: "B00123455" },
  number: "ALB-7",
  issueDate: "2026-10-14",
  totals: null,
  lines: [
    {
      supplierCode: "A-1",
      description: "Tomate pera",
      quantity: "5",
      unit: "kg",
      unitPrice: null,
      discountPercent: null,
      vatRate: null,
      lineTotal: null,
    },
    {
      supplierCode: "A-2",
      description: "Cebolla",
      quantity: "3",
      unit: "kg",
      unitPrice: null,
      discountPercent: null,
      vatRate: null,
      lineTotal: null,
    },
  ],
};
const wrongNumber: ExtractedDocument = { ...gold, number: "ALB-8" };

function record(costMicroUsd: number | null, latencyMs = 1000): CallRecord {
  return {
    model: "vendor/model",
    promptVersion: "v1",
    attempts: 1,
    promptTokens: 1000,
    completionTokens: 200,
    costMicroUsd,
    latencyMs,
    structuredOutputFailed: false,
  };
}

const extracted = (
  document: ExtractedDocument,
  callRecord: CallRecord | null = record(100),
): FileResult => ({ status: "extracted", document, record: callRecord });

const run = (
  result: FileResult,
  validationFailures: DocumentRun["validationFailures"] = [],
): DocumentRun => ({ gold, result, validationFailures });

describe("evaluateDocument: each document has exactly one outcome", () => {
  it.each([
    ["extracted, valid and right", run(extracted(gold)), "correct", null],
    [
      "extracted and valid, but wrong: a silent error",
      run(extracted(wrongNumber)),
      "silent-error",
      null,
    ],
    [
      "extracted, but failing a validation check",
      run(extracted(gold), ["total"]),
      "review",
      "validation",
    ],
    [
      "invalid output twice",
      run({
        status: "needs-review",
        reason: "the output was invalid twice",
        issues: [],
        record: record(100),
      }),
      "review",
      "needs-review",
    ],
    [
      "a failed call",
      run({
        status: "failed",
        message: "HTTP 500",
        httpStatus: 500,
        record: record(null),
      }),
      "review",
      "failed",
    ],
    [
      "a refused file",
      run({ status: "rejected", reason: "HEIC", record: null }),
      "review",
      "rejected",
    ],
  ] as const)("%s", (_case, input, outcome, reviewBecause) => {
    expect(evaluateDocument(input)).toMatchObject({ outcome, reviewBecause });
  });

  it("a document that failed validation is still compared, so field accuracy measures the reading", () => {
    const evaluation = evaluateDocument(run(extracted(wrongNumber), ["total"]));
    expect(evaluation.comparison?.differences).toEqual(["number"]);
  });

  it("without a document there is nothing to compare", () => {
    const evaluation = evaluateDocument(
      run({ status: "rejected", reason: "HEIC", record: null }),
    );
    expect(evaluation.comparison).toBeNull();
  });
});

describe("summarize: the run's metrics", () => {
  const evaluations = [
    run(extracted(gold, record(1000, 800))),
    run(extracted(wrongNumber, record(3000, 1200))),
    run(extracted({ ...gold, lines: [gold.lines[0]!] }, record(null, 5000)), [
      "missing-value",
    ]),
    run({
      status: "failed",
      message: "HTTP 500",
      httpStatus: 500,
      record: record(2000, 300),
    }),
    run(extracted(gold, null)),
  ].map(evaluateDocument);
  const summary = summarize(evaluations);

  it("the silent error rate and review rate are over all documents", () => {
    expect(summary.documents).toBe(5);
    expect(summary.outcomes).toEqual({
      correct: 2,
      "silent-error": 1,
      review: 2,
    });
    expect(summary.silentErrorRate).toEqual({ part: 1, whole: 5 });
    expect(summary.reviewRate).toEqual({ part: 2, whole: 5 });
  });

  it("field accuracies are over documents that produced a document, review by validation included", () => {
    expect(summary.headerAccuracy.number).toEqual({ part: 3, whole: 4 });
    expect(summary.headerAccuracy["supplier.taxId"]).toEqual({
      part: 4,
      whole: 4,
    });
  });

  it("line precision and recall add up lines over all compared documents", () => {
    // 8 gold lines in 4 documents; one result had only 1 of its 2.
    expect(summary.lineRecall).toEqual({ part: 7, whole: 8 });
    expect(summary.linePrecision).toEqual({ part: 7, whole: 7 });
    expect(summary.lineFieldAccuracy.quantity).toEqual({ part: 7, whole: 7 });
  });

  it("cost per document counts only reported costs; an unknown cost is never taken as 0", () => {
    expect(summary.cost).toEqual({
      totalMicroUsd: 6000,
      perDocumentMicroUsd: 2000,
      documentsCounted: 3,
      documentsWithUnknownCost: 1,
      documentsWithoutCall: 1,
    });
  });

  it("latency is over every call, by nearest rank", () => {
    expect(summary.latencyMs).toEqual({
      p50: 800,
      p95: 5000,
      documentsCounted: 4,
    });
  });

  it("an empty run has empty ratios and no averages", () => {
    const empty = summarize([]);
    expect(empty.silentErrorRate).toEqual({ part: 0, whole: 0 });
    expect(empty.cost.perDocumentMicroUsd).toBeNull();
    expect(empty.latencyMs.p50).toBeNull();
  });
});

describe("percentile: nearest rank", () => {
  it("of 1 to 20, p50 is 10 and p95 is 19", () => {
    const values = Array.from({ length: 20 }, (_v, i) => 20 - i);
    expect(percentile(values, 50)).toBe(10);
    expect(percentile(values, 95)).toBe(19);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("summarize: properties", () => {
  it("results identical to their gold answers score 100% everywhere, with no silent errors", () => {
    fc.assert(
      fc.property(
        fc.array(document, { minLength: 1, maxLength: 5 }),
        (docs) => {
          const summary = summarize(
            docs.map((doc) =>
              evaluateDocument({
                gold: doc,
                result: extracted(doc),
                validationFailures: [],
              }),
            ),
          );
          const whole = (ratio: { part: number; whole: number }) =>
            ratio.part === ratio.whole;
          expect(summary.outcomes.correct).toBe(docs.length);
          expect(summary.silentErrorRate.part).toBe(0);
          expect(summary.reviewRate.part).toBe(0);
          expect(
            HEADER_FIELDS.every((f) => whole(summary.headerAccuracy[f])),
          ).toBe(true);
          expect(
            LINE_FIELDS.every((f) => whole(summary.lineFieldAccuracy[f])),
          ).toBe(true);
          expect(
            whole(summary.linePrecision) && whole(summary.lineRecall),
          ).toBe(true);
        },
      ),
    );
  });

  it("every document lands in exactly one outcome, so the outcomes add up to the documents", () => {
    const anyResult: fc.Arbitrary<FileResult> = fc.oneof(
      document.map((doc) => extracted(doc)),
      fc.constant<FileResult>({
        status: "failed",
        message: "HTTP 500",
        httpStatus: 500,
        record: record(10),
      }),
      fc.constant<FileResult>({
        status: "rejected",
        reason: "unknown",
        record: null,
      }),
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            gold: document,
            result: anyResult,
            validationFailures: fc.subarray([...CHECKS]),
          }),
          { maxLength: 8 },
        ),
        (runs) => {
          const summary = summarize(runs.map(evaluateDocument));
          const { correct, review } = summary.outcomes;
          expect(correct + summary.outcomes["silent-error"] + review).toBe(
            runs.length,
          );
          expect(summary.silentErrorRate.whole).toBe(runs.length);
          expect(summary.reviewRate.whole).toBe(runs.length);
        },
      ),
    );
  });
});
