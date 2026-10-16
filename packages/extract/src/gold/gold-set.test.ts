import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ExtractedDocument } from "@kitchen-ops/shared";
import {
  GOLD_DIRECTORY,
  goldEntryProblems,
  goldIds,
  readGoldEntry,
  type GoldEntry,
} from "./gold-set";
import { GoldMeta } from "./meta";
import { renderGoldPdf } from "./render";

// A minimal valid entry, to break one thing at a time.
const expected: ExtractedDocument = {
  documentType: "delivery-note",
  currency: "EUR",
  supplier: { name: "Proveedor Ficticio S.L.", taxId: null },
  number: null,
  issueDate: null,
  totals: null,
  lines: [
    {
      supplierCode: null,
      description: "Producto",
      quantity: "1",
      unit: "ud",
      unitPrice: null,
      discountPercent: null,
      vatRate: null,
      lineTotal: null,
    },
  ],
};
const meta: GoldMeta = {
  origin: "synthetic",
  kind: "text-pdf",
  notes: "A minimal example.",
  checked: { by: "repo-owner", on: "2026-10-16" },
};
const valid: GoldEntry = {
  id: "syn-999-example",
  files: ["expected.json", "meta.json", "source.pdf"],
  expected,
  meta,
};

describe("goldEntryProblems: what makes a gold folder invalid", () => {
  it("a complete, checked folder has no problems", () => {
    expect(goldEntryProblems(valid)).toEqual([]);
  });

  it("a folder name that isn't lowercase letters, digits and hyphens", () => {
    expect(goldEntryProblems({ ...valid, id: "Syn_001" })).toEqual([
      "Syn_001: the folder name must be lowercase letters, digits and hyphens",
    ]);
  });

  it("no source, two sources, a missing expected.json or meta.json, or an extra file", () => {
    expect(
      goldEntryProblems({ ...valid, files: ["expected.json", "meta.json"] }),
    ).toEqual([
      "syn-999-example: needs exactly one source file (source.pdf, .jpg, .png or .xml), found 0",
    ]);
    expect(
      goldEntryProblems({
        ...valid,
        files: [...valid.files, "source.png"],
      }),
    ).toEqual([
      "syn-999-example: needs exactly one source file (source.pdf, .jpg, .png or .xml), found 2",
    ]);
    expect(
      goldEntryProblems({
        ...valid,
        files: ["meta.json", "source.pdf"],
        expected: undefined,
      }),
    ).toEqual(["syn-999-example: missing expected.json"]);
    expect(
      goldEntryProblems({ ...valid, files: [...valid.files, "notes.txt"] }),
    ).toEqual(["syn-999-example: unexpected file notes.txt"]);
  });

  it("an expected.json that isn't valid JSON, or doesn't match the extraction schema, naming the field", () => {
    expect(goldEntryProblems({ ...valid, expected: undefined })).toEqual([
      "syn-999-example: expected.json isn't valid JSON",
    ]);
    expect(
      goldEntryProblems({ ...valid, expected: { ...expected, lines: [] } }),
    ).toEqual([
      "syn-999-example: expected.json: lines: Too small: expected array to have >=1 items",
    ]);
  });

  it("a meta.json with an unknown origin or kind, or an unknown key", () => {
    expect(
      goldEntryProblems({ ...valid, meta: { ...meta, origin: "client" } }),
    ).toEqual([
      expect.stringMatching(/^syn-999-example: meta\.json: origin: /),
    ]);
    expect(
      goldEntryProblems({ ...valid, meta: { ...meta, checkedBy: "x" } }),
    ).toEqual([
      expect.stringMatching(/^syn-999-example: meta\.json: : Unrecognized key/),
    ]);
  });

  it("a source whose file type doesn't fit its kind: an XML file that claims to be a photo", () => {
    expect(
      goldEntryProblems({
        ...valid,
        files: ["expected.json", "meta.json", "source.xml"],
        meta: { ...meta, kind: "photo" },
      }),
    ).toEqual([
      "syn-999-example: a .xml source can't be of kind photo (expected facturae-xml)",
    ]);
  });

  it("an answer nobody has checked yet", () => {
    expect(
      goldEntryProblems({ ...valid, meta: { ...meta, checked: null } }),
    ).toEqual([
      "syn-999-example: expected.json hasn't been checked against its source by a person (meta.json: checked)",
    ]);
  });
});

describe("the gold set in eval/gold", () => {
  const ids = goldIds(GOLD_DIRECTORY);

  it("has documents", () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  it("every folder is complete, valid and checked by a person", () => {
    const problems = ids.flatMap((id) =>
      goldEntryProblems(readGoldEntry(GOLD_DIRECTORY, id)),
    );
    expect(problems).toEqual([]);
  });

  it("every synthetic PDF is exactly what rendering its expected.json produces, so the document matches its answer", async () => {
    const outdated: string[] = [];
    for (const id of ids) {
      const entry = readGoldEntry(GOLD_DIRECTORY, id);
      const parsedMeta = GoldMeta.safeParse(entry.meta);
      if (
        !parsedMeta.success ||
        parsedMeta.data.origin !== "synthetic" ||
        parsedMeta.data.kind !== "text-pdf"
      ) {
        continue;
      }
      const rendered = await renderGoldPdf(entry.expected as ExtractedDocument);
      const committed = readFileSync(
        new URL(`${id}/source.pdf`, GOLD_DIRECTORY),
      );
      if (!rendered.equals(committed)) outdated.push(id);
    }
    // Fix with: pnpm --filter @kitchen-ops/extract gold:render
    expect(outdated).toEqual([]);
  });
});
