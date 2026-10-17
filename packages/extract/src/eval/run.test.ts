import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ExtractedDocument } from "@kitchen-ops/shared";
import type { ModelConfig } from "../llm/config";
import { CLIENT_ROUTING, type CallRecord } from "../llm/extract";
import type { ChatReply, OpenRouterClient } from "../llm/openrouter";
import type { Prompt } from "../llm/prompts";
import { sha256Hex, type FileExtraction } from "../route/route";
import { runEval, type RunOptions } from "./run";
import { loadSet, type EvalSet } from "./sets";

const goldSet = loadSet("gold", {});
const byId = (id: string) => goldSet.documents.find((d) => d.id === id)!;
const textPdf = byId("syn-002-invoice-discounts-two-vat");
const facturae = byId("syn-006-facturae");

/** The two synthetic fixtures: a text PDF and a Facturae invoice. */
const fixtures: EvalSet = { ...goldSet, documents: [textPdf, facturae] };

const structured: ModelConfig = {
  id: "vendor/structured",
  structuredOutput: true,
  vision: true,
};
const plain: ModelConfig = {
  id: "vendor/plain",
  structuredOutput: false,
  vision: true,
};
const prompt: Prompt = { version: "v1", text: "Extract the document." };

const reply = (content: unknown, cost: number | null = 0.0012): ChatReply => ({
  content: typeof content === "string" ? content : JSON.stringify(content),
  promptTokens: 1000,
  completionTokens: 200,
  cost,
});

/** A fake client answering with `replies` in turn (the last one repeats), remembering requests. */
function fakeClient(...replies: ChatReply[]) {
  const requests: Record<string, unknown>[] = [];
  const client: OpenRouterClient = {
    complete: async (body) => {
      requests.push(structuredClone(body));
      return replies.length > 1 ? replies.shift()! : replies[0]!;
    },
  };
  return { client, requests };
}

const options = (overrides: Partial<RunOptions>): RunOptions => ({
  set: fixtures,
  models: [structured],
  prompt,
  client: fakeClient(reply(textPdf.gold)).client,
  maxMicroUsd: 1_000_000,
  today: "2026-10-18",
  ...overrides,
});

describe("runEval: routing, extraction, validation and evaluation, document by document", () => {
  it("two synthetic documents read perfectly: both correct, nothing to review, the cost what the one call cost", async () => {
    const [run] = await runEval(options({}));
    expect(run!.summary.outcomes).toEqual({
      correct: 2,
      "silent-error": 0,
      review: 0,
    });
    expect(run!.summary.cost).toMatchObject({
      totalMicroUsd: 1200,
      documentsWithoutCall: 1,
    });
    expect(run!.documents.map((d) => [d.id, d.route, d.outcome])).toEqual([
      [textPdf.id, "pdf-text", "correct"],
      [facturae.id, "facturae-xml", "correct"],
    ]);
    // Gold results may keep the values read.
    expect(run!.documents[0]!.document).toEqual(textPdf.gold);
  });

  it("a wrong reading that passes validation is a silent error, with the field named", async () => {
    const wrong: ExtractedDocument = { ...textPdf.gold, number: "F-9" };
    const [run] = await runEval(
      options({ client: fakeClient(reply(wrong)).client }),
    );
    expect(run!.documents[0]).toMatchObject({
      outcome: "silent-error",
      differences: ["number"],
    });
  });

  it("validation runs as if each document arrived on its gold date: a right date passes years later, a misread one doesn't", async () => {
    const later = await runEval(options({ today: "2031-01-01" }));
    expect(later[0]!.documents[0]!.outcome).toBe("correct");

    const misread = { ...textPdf.gold, issueDate: "2024-10-15" };
    const [run] = await runEval(
      options({ client: fakeClient(reply(misread)).client }),
    );
    expect(run!.documents[0]).toMatchObject({
      outcome: "review",
      reviewBecause: "validation",
      validationFailures: ["date"],
    });
  });

  it("a private run sends every call with restricted routing, and keeps no values read, naming documents by hash", async () => {
    const { client, requests } = fakeClient(reply(textPdf.gold));
    const [run] = await runEval(
      options({
        set: { ...fixtures, name: "private", source: "client" },
        client,
      }),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.provider).toMatchObject(CLIENT_ROUTING);
    for (const [i, document] of run!.documents.entries()) {
      expect(document.document).toBeNull();
      const source = fixtures.documents[i]!.source;
      expect(document.id).toBe(sha256Hex(source).slice(0, 12));
    }
  });

  it("each model gets its own run; the structured-output failure rate only counts models that ask for it", async () => {
    const { client } = fakeClient(
      reply("not JSON"),
      reply(textPdf.gold),
      reply("not JSON"),
      reply(textPdf.gold),
    );
    const runs = await runEval(
      options({ models: [structured, plain], client }),
    );
    expect(runs.map((r) => r.model.id)).toEqual([
      "vendor/structured",
      "vendor/plain",
    ]);
    expect(runs[0]!.structuredOutput).toEqual({ part: 1, whole: 1 });
    expect(runs[1]!.structuredOutput).toBeNull();
  });
});

const record = (costMicroUsd: number | null): CallRecord => ({
  model: "vendor/structured",
  promptVersion: "v1",
  attempts: 1,
  promptTokens: 1000,
  completionTokens: 200,
  costMicroUsd,
  latencyMs: 900,
  structuredOutputFailed: false,
});

/** A fake extraction reading every document perfectly, at the costs given in turn. */
function perfectReader(costs: (number | null)[]): RunOptions["extract"] {
  const gold = new Map(
    goldSet.documents.map((d) => [sha256Hex(d.source), d.gold]),
  );
  let call = 0;
  return async (_client, bytes): Promise<FileExtraction> => {
    const sha256 = sha256Hex(bytes);
    return {
      sha256,
      route: "pdf-text",
      result: {
        status: "extracted",
        document: gold.get(sha256)!,
        record: record(costs[call++] ?? 0),
      },
    };
  };
}

const subsetOfGold = fc
  .subarray([...goldSet.documents], { minLength: 1 })
  .chain((documents) =>
    fc.shuffledSubarray(documents, { minLength: documents.length }),
  );

describe("runEval: properties", () => {
  it("any gold documents, read perfectly, are all correct, with cost the sum of the calls", async () => {
    await fc.assert(
      fc.asyncProperty(
        subsetOfGold,
        fc.array(fc.nat({ max: 5000 }), { minLength: 6, maxLength: 6 }),
        async (documents, costs) => {
          const [run] = await runEval(
            options({
              set: { ...goldSet, documents },
              extract: perfectReader(costs),
            }),
          );
          const n = documents.length;
          expect(run!.summary.outcomes.correct).toBe(n);
          expect(run!.summary.silentErrorRate.part).toBe(0);
          expect(run!.summary.reviewRate.part).toBe(0);
          const spent = costs.slice(0, n).reduce((a, b) => a + b, 0);
          expect(run!.summary.cost.totalMicroUsd).toBe(spent);
        },
      ),
    );
  });

  it("the run stops at the first document after spend passes the cap, never earlier, and lists the rest as not run", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.nat({ max: 1000 }), { minLength: 6, maxLength: 6 }),
        fc.nat({ max: 4000 }),
        async (costs, cap) => {
          const [run] = await runEval(
            options({
              set: goldSet,
              extract: perfectReader(costs),
              maxMicroUsd: cap,
            }),
          );
          // Document i runs if what was spent before it hasn't passed the cap.
          let spent = 0;
          let expected = 0;
          for (const cost of costs) {
            if (spent > cap) break;
            spent += cost;
            expected++;
          }
          expect(run!.documents).toHaveLength(expected);
          expect(run!.documents.length + run!.notRun.length).toBe(6);
          expect(run!.stoppedBecause).toBe(
            expected < 6 ? "spending-cap" : null,
          );
        },
      ),
    );
  });
});

describe("runEval: stopping", () => {
  it("a call with no reported cost stops the run: the cap can't be kept without knowing what was spent", async () => {
    const [run] = await runEval(
      options({ set: goldSet, extract: perfectReader([100, null, 100]) }),
    );
    expect(run!.documents).toHaveLength(2);
    expect(run!.notRun).toHaveLength(4);
    expect(run!.stoppedBecause).toBe("unknown-cost");
  });

  it("the cap is for the whole run: once passed, later models don't run at all", async () => {
    const runs = await runEval(
      options({
        set: goldSet,
        models: [structured, plain],
        extract: perfectReader([600, 600]),
        maxMicroUsd: 1000,
      }),
    );
    expect(runs[0]!.documents).toHaveLength(2);
    expect(runs[1]!.documents).toHaveLength(0);
    expect(runs[1]!.notRun).toHaveLength(6);
    expect(runs[1]!.stoppedBecause).toBe("spending-cap");
  });
});
