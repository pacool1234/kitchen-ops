import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { GOLD_DIRECTORY, goldIds, readGoldEntry } from "./gold-set";
import { GOLD_KINDS, GOLD_MADE, GOLD_ORIGINS, GoldMeta } from "./meta";
import { goldReadme, type ReadmeEntry } from "./readme";

const rendered: GoldMeta = {
  origin: "synthetic",
  kind: "text-pdf",
  made: "rendered",
  notes: "Two VAT rates.",
  checked: { by: "repo-owner", on: "2026-10-17" },
};
const facturae: GoldMeta = {
  origin: "synthetic",
  kind: "facturae-xml",
  notes: "Facturae 3.2.2.",
  checked: { by: "repo-owner", on: "2026-10-17" },
};

/** The table's rows, without the header and separator. */
const rows = (readme: string) =>
  readme
    .split("\n")
    .filter((line) => line.startsWith("| "))
    .slice(1);

describe("goldReadme: the README listing every gold document", () => {
  it("one row per document, in the order given: folder, origin, kind, how it was made, what makes it hard", () => {
    const readme = goldReadme([
      { id: "syn-001-a", meta: rendered },
      { id: "syn-002-b", meta: facturae },
    ]);
    expect(rows(readme)).toEqual([
      "| syn-001-a | synthetic | text-pdf | rendered | Two VAT rates. |",
      "| syn-002-b | synthetic | facturae-xml | | Facturae 3.2.2. |",
    ]);
    expect(readme).toContain(
      "| Folder | Origin | Kind | Made | What makes it hard |",
    );
  });

  it("says it's generated, and how to regenerate it", () => {
    expect(goldReadme([])).toContain(
      "pnpm --filter @kitchen-ops/extract gold:readme",
    );
  });

  it("counts the documents of each kind", () => {
    const readme = goldReadme([
      { id: "a", meta: rendered },
      { id: "b", meta: rendered },
      { id: "c", meta: facturae },
    ]);
    expect(readme).toContain(
      "3 documents: 2 text-pdf, 0 scan, 0 photo, 1 facturae-xml.",
    );
  });

  it("a note with a pipe or a line break stays in its own cell", () => {
    const [row] = rows(
      goldReadme([
        { id: "a", meta: { ...rendered, notes: "Units | prices\nsplit" } },
      ]),
    );
    expect(row).toBe(
      String.raw`| a | synthetic | text-pdf | rendered | Units \| prices split |`,
    );
  });
});

const anyEntry = fc.record({
  id: fc.stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  meta: fc.record({
    origin: fc.constantFrom(...GOLD_ORIGINS),
    kind: fc.constantFrom(...GOLD_KINDS),
    made: fc.constantFrom(...GOLD_MADE),
    notes: fc.string({ minLength: 1 }),
    checked: fc.constant({ by: "repo-owner", on: "2026-10-17" }),
  }),
}) satisfies fc.Arbitrary<ReadmeEntry>;

describe("goldReadme: properties", () => {
  it("any documents: one row each, in order, each starting with its folder and with exactly five cells", () => {
    fc.assert(
      fc.property(fc.array(anyEntry, { maxLength: 30 }), (entries) => {
        const table = rows(goldReadme(entries));
        expect(table).toHaveLength(entries.length);
        for (const [i, row] of table.entries()) {
          expect(row.startsWith(`| ${entries[i]!.id} |`)).toBe(true);
          // Cells are separated by pipes that aren't escaped.
          expect(row.split(/(?<!\\)\|/)).toHaveLength(7);
        }
      }),
    );
  });
});

describe("eval/gold/README.md", () => {
  it("is what gold:readme writes from the meta.json files, so it lists every document as it is", () => {
    const entries = goldIds(GOLD_DIRECTORY).flatMap((id) => {
      const meta = GoldMeta.safeParse(readGoldEntry(GOLD_DIRECTORY, id).meta);
      return meta.success ? [{ id, meta: meta.data }] : []; // invalid ones fail the gold set test
    });
    const committed = readFileSync(
      new URL("README.md", GOLD_DIRECTORY),
      "utf8",
    );
    // Fix with: pnpm --filter @kitchen-ops/extract gold:readme
    expect(committed).toBe(goldReadme(entries));
  });
});
