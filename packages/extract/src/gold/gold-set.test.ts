import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExtractedDocument } from "@kitchen-ops/shared";
import {
  GOLD_DIRECTORY,
  goldEntryProblems,
  goldIds,
  readGoldEntry,
  type GoldEntry,
} from "./gold-set";
import fc from "fast-check";
import {
  GOLD_KINDS,
  GOLD_MADE,
  GOLD_ORIGINS,
  GoldMeta,
  isRendered,
  type GoldKind,
} from "./meta";
import { fileMetadata } from "./metadata";
import { renderGoldPdf } from "./render";
import { validate } from "../validation/checks";

// A minimal valid entry, to break one thing at a time.
const expected: ExtractedDocument = {
  documentType: "delivery-note",
  currency: "EUR",
  supplier: { name: "Proveedor Ficticio S.L.", taxId: null },
  number: null,
  issueDate: null,
  deliveryNotes: [],
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
/** Without `made`: what anything but a synthetic text PDF looks like. */
const withoutMade: GoldMeta = {
  origin: "synthetic",
  kind: "text-pdf",
  notes: "A minimal example.",
  checked: { by: "repo-owner", on: "2026-10-16" },
};
const meta: GoldMeta = { ...withoutMade, made: "rendered" };
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

  it("an expected.json that doesn't say which delivery notes it lists, even none (#120)", () => {
    const unsaid: Record<string, unknown> = { ...expected };
    delete unsaid.deliveryNotes;
    expect(goldEntryProblems({ ...valid, expected: unsaid })).toEqual([
      "syn-999-example: expected.json: deliveryNotes: Invalid input: expected array, received undefined",
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
        meta: { ...withoutMade, kind: "photo" },
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

  it("a synthetic text PDF that doesn't say how it was made", () => {
    expect(goldEntryProblems({ ...valid, meta: withoutMade })).toEqual([
      "syn-999-example: a synthetic text PDF must say how it was made (meta.json: made: rendered or elsewhere)",
    ]);
  });

  it("anything else saying how it was made: an own PDF, or a photo", () => {
    expect(
      goldEntryProblems({ ...valid, meta: { ...meta, origin: "own" } }),
    ).toEqual([
      "syn-999-example: only a synthetic text PDF says how it was made (meta.json: made)",
    ]);
    expect(
      goldEntryProblems({
        ...valid,
        files: ["expected.json", "meta.json", "source.jpg"],
        meta: { ...meta, kind: "photo" },
      }),
    ).toEqual([
      "syn-999-example: only a synthetic text PDF says how it was made (meta.json: made)",
    ]);
  });
});

/** A source file that fits each kind. */
const SOURCE_FOR: Record<GoldKind, string> = {
  "text-pdf": "source.pdf",
  scan: "source.pdf",
  photo: "source.jpg",
  "facturae-xml": "source.xml",
};

const anyMeta = fc.record({
  origin: fc.constantFrom(...GOLD_ORIGINS),
  kind: fc.constantFrom(...GOLD_KINDS),
  made: fc.constantFrom(undefined, ...GOLD_MADE),
});

/** A folder with this origin, kind and `made` (left out when undefined), otherwise valid. */
const entryWith = ({
  made,
  ...rest
}: {
  origin: GoldMeta["origin"];
  kind: GoldKind;
  made: GoldMeta["made"];
}): GoldEntry => {
  return {
    ...valid,
    files: ["expected.json", "meta.json", SOURCE_FOR[rest.kind]],
    meta: { ...withoutMade, ...rest, ...(made === undefined ? {} : { made }) },
  };
};

describe("isRendered: what gold:render may overwrite", () => {
  it("never an own document or a scan, even one wrongly marked made: rendered", () => {
    expect(isRendered(meta)).toBe(true);
    expect(isRendered({ ...meta, origin: "own" })).toBe(false);
    expect(isRendered({ ...meta, kind: "scan" })).toBe(false);
  });
});

describe("how a synthetic text PDF was made: properties", () => {
  it("a folder says how it was made exactly when it's a synthetic text PDF", () => {
    fc.assert(
      fc.property(anyMeta, (m) => {
        const shouldSay = m.origin === "synthetic" && m.kind === "text-pdf";
        const says = m.made !== undefined;
        expect(goldEntryProblems(entryWith(m))).toHaveLength(
          shouldSay === says ? 0 : 1,
        );
      }),
    );
  });

  it("a valid folder is rendered, so checked against the renderer, exactly when it says made: rendered", () => {
    fc.assert(
      fc.property(anyMeta, (m) => {
        const entry = entryWith(m);
        fc.pre(goldEntryProblems(entry).length === 0);
        expect(isRendered(GoldMeta.parse(entry.meta))).toBe(
          m.made === "rendered",
        );
      }),
    );
  });
});

describe("the gold set in eval/gold", () => {
  const ids = goldIds(GOLD_DIRECTORY);

  it("has 20 to 30 documents: enough for the metrics to mean something, few enough to check by hand (spec section 9)", () => {
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(ids.length).toBeLessThanOrEqual(30);
  });

  it("every folder is complete, valid and checked by a person", () => {
    const problems = ids.flatMap((id) =>
      goldEntryProblems(readGoldEntry(GOLD_DIRECTORY, id)),
    );
    expect(problems).toEqual([]);
  });

  it("every gold answer passes every validation check: a gold answer that doesn't add up is a mistake in the answer", () => {
    // The date and duplicate checks depend on when and where a document arrives; this context
    // lets every gold date and number through, so only the document's own checks count.
    const context = {
      today: "2026-12-31",
      maxAgeDays: 365,
      knownNumbers: [],
    };
    const failures = ids.flatMap((id) => {
      const parsed = ExtractedDocument.safeParse(
        readGoldEntry(GOLD_DIRECTORY, id).expected,
      );
      if (!parsed.success) return []; // reported by the test above
      // Check names and paths only: messages may show document contents.
      return validate(parsed.data, context).failures.map(
        (f) => `${id}: ${f.check} ${f.path}`,
      );
    });
    expect(failures).toEqual([]);
  });

  it("every rendered synthetic PDF is exactly what rendering its expected.json produces, so the document matches its answer", async () => {
    const outdated: string[] = [];
    for (const id of ids) {
      const entry = readGoldEntry(GOLD_DIRECTORY, id);
      const parsedMeta = GoldMeta.safeParse(entry.meta);
      if (!parsedMeta.success || !isRendered(parsedMeta.data)) continue;
      const rendered = await renderGoldPdf(entry.expected as ExtractedDocument);
      const committed = readFileSync(
        new URL(`${id}/source.pdf`, GOLD_DIRECTORY),
      );
      if (!rendered.equals(committed)) outdated.push(id);
    }
    // Fix with: pnpm --filter @kitchen-ops/extract gold:render
    expect(outdated).toEqual([]);
  });

  it("no source file carries metadata: the repository is public, and a phone photo's EXIF holds where it was taken", () => {
    const found = ids.flatMap((id) => {
      const source = readGoldEntry(GOLD_DIRECTORY, id).files.find((file) =>
        file.startsWith("source."),
      );
      if (source === undefined) return []; // reported by the folder test
      const bytes = readFileSync(new URL(`${id}/${source}`, GOLD_DIRECTORY));
      return fileMetadata(new Uint8Array(bytes)).map(
        (what) => `${id}: ${what}`,
      );
    });
    expect(found).toEqual([]);
  });
});
