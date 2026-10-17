import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GOLD_DIRECTORY, goldIds } from "../gold/gold-set";
import { loadSet, PRIVATE_SET_VARIABLE, RESULTS_DIRECTORY } from "./sets";

const gold = fileURLToPath(GOLD_DIRECTORY);

/** A temporary folder laid out like a set, holding copies of the gold documents named. */
function setFolder(documents: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "eval-set-"));
  for (const [folder, goldId] of Object.entries(documents)) {
    cpSync(join(gold, goldId), join(directory, folder), { recursive: true });
  }
  return directory;
}

describe("loadSet: the documents a run goes through", () => {
  it("the gold set is every gold folder, sent without restrictions, with results in eval/results", () => {
    const set = loadSet("gold", {});
    expect(set.name).toBe("gold");
    expect(set.source).toBe("own-or-public");
    expect(set.documents.map((d) => d.id)).toEqual(goldIds(GOLD_DIRECTORY));
    expect(set.resultsDirectory).toBe(fileURLToPath(RESULTS_DIRECTORY));
    for (const document of set.documents) {
      expect(document.source.length).toBeGreaterThan(0);
      expect(document.gold.lines.length).toBeGreaterThan(0);
    }
  });

  it("the private set is only found through its environment variable", () => {
    expect(() => loadSet("private", {})).toThrow(PRIVATE_SET_VARIABLE);
    expect(() => loadSet("private", { [PRIVATE_SET_VARIABLE]: "" })).toThrow(
      PRIVATE_SET_VARIABLE,
    );
  });

  it("the private set is a client set: restricted routing, results kept in its own results folder", () => {
    const directory = setFolder({
      "a folder with spaces": "syn-002-invoice-discounts-two-vat",
      second: "syn-006-facturae",
    });
    mkdirSync(join(directory, "results"));
    const set = loadSet("private", { [PRIVATE_SET_VARIABLE]: directory });
    expect(set.source).toBe("client");
    expect(set.resultsDirectory).toBe(join(directory, "results"));
    // The results folder isn't a document.
    expect(set.documents).toHaveLength(2);
  });

  it("a broken private document is named by its position, never by its folder name, which may name a client", () => {
    const directory = setFolder({ first: "syn-002-invoice-discounts-two-vat" });
    mkdirSync(join(directory, "Client Name Ltd"));
    writeFileSync(join(directory, "Client Name Ltd", "expected.json"), "{}");
    const load = () =>
      loadSet("private", { [PRIVATE_SET_VARIABLE]: directory });
    expect(load).toThrow("document 1: no source file");
    expect(load).not.toThrow("Client Name");
  });

  it("an answer that doesn't match the schema stops the run before any call", () => {
    const directory = setFolder({ only: "syn-002-invoice-discounts-two-vat" });
    writeFileSync(join(directory, "only", "expected.json"), '{"lines": []}');
    expect(() =>
      loadSet("private", { [PRIVATE_SET_VARIABLE]: directory }),
    ).toThrow("document 1: expected.json doesn't match the extraction schema");
  });
});
