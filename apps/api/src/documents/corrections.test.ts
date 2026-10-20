import type { ExtractedDocument } from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fakeDocument } from "../extraction/fake";
import { mayCorrect } from "./corrections";

// Who may correct what in review (spec section 6, decision 0037): office and owner, anything;
// a counter user, only the quantities of a delivery note's lines ("receive a delivery, confirm
// quantities"). The API refuses the rest (draft.test.ts).

const read = (type: ExtractedDocument["documentType"]): ExtractedDocument => ({
  ...fakeDocument("2026-10-20"),
  documentType: type,
});

const LINE_FIELDS = [
  "supplierCode",
  "description",
  "quantity",
  "unit",
  "unitPrice",
  "discountPercent",
  "vatRate",
  "lineTotal",
] as const;

/** Every value of the fake document a person could change, as a path to it. */
const OTHER_PATHS: readonly (readonly (string | number)[])[] = [
  ["supplier", "name"],
  ["supplier", "taxId"],
  ["number"],
  ["issueDate"],
  ["totals", "net"],
  ["totals", "total"],
  ["totals", "vat", 0, "rate"],
  ["totals", "vat", 0, "base"],
  ["totals", "vat", 0, "amount"],
  ...[0, 1].flatMap((i) =>
    LINE_FIELDS.filter((f) => f !== "quantity").map((f) => ["lines", i, f]),
  ),
];

type Path = readonly (string | number)[];

function valueAt(document: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (value, key) => (value as Record<string | number, unknown>)[key],
    document,
  );
}

/** The document with each value replaced, or with the given change made. */
function edited(
  document: ExtractedDocument,
  edits: readonly { path: Path; value: string | null }[],
): ExtractedDocument {
  const copy = structuredClone(document);
  for (const { path, value } of edits) {
    const parent = valueAt(copy, path.slice(0, -1)) as Record<
      string | number,
      unknown
    >;
    parent[path.at(-1)!] = value;
  }
  return copy;
}

/** A value different from the one at `path`: text added to it, or null for one that isn't. */
const differentAt = (document: ExtractedDocument, path: Path) =>
  fc
    .oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 8 }))
    .map((value) => {
      const now = valueAt(document, path);
      return value === now || (value === null && now === null)
        ? `${String(now)}x`
        : value;
    });

/** One to two of the lines' quantities, each changed: to a decimal, or to null. */
const quantityEdits = fc.uniqueArray(
  fc.record({
    path: fc.constantFrom<Path>(
      ["lines", 0, "quantity"],
      ["lines", 1, "quantity"],
    ),
    value: fc.option(fc.stringMatching(/^-?\d{1,4}(\.\d{1,6})?$/), {
      nil: null,
    }),
  }),
  { maxLength: 2, selector: (edit) => edit.path.join(".") },
);

/** At least one value other than a quantity, really changed. */
const otherEdits = (document: ExtractedDocument) =>
  fc
    .uniqueArray(fc.constantFrom(...OTHER_PATHS), {
      minLength: 1,
      maxLength: 3,
      selector: (path) => path.join("."),
    })
    .chain((paths) =>
      fc
        .tuple(...paths.map((path) => differentAt(document, path)))
        .map((values) => paths.map((path, i) => ({ path, value: values[i]! }))),
    );

const types = fc.constantFrom("delivery-note" as const, "invoice" as const);

describe("who may correct what (spec section 6, decision 0037)", () => {
  it("office and owner may save any correction, of any document, read or not", () => {
    const corrections = types.chain((type) =>
      fc.record({
        document: fc.constant(read(type)),
        others: otherEdits(read(type)),
        quantities: quantityEdits,
      }),
    );
    fc.assert(
      fc.property(
        fc.constantFrom("office" as const, "owner" as const),
        fc.boolean(),
        corrections,
        (role, wasRead, { document, others, quantities }) => {
          const before = wasRead ? document : null;
          const after = edited(document, [...others, ...quantities]);
          expect(mayCorrect(role, before, after)).toBe(true);
        },
      ),
    );
  });

  it("a counter user may change any of a delivery note's line quantities, or none", () => {
    const before = read("delivery-note");
    fc.assert(
      fc.property(quantityEdits, (edits) => {
        expect(mayCorrect("counter", before, edited(before, edits))).toBe(true);
      }),
    );
  });

  it("a counter user may not change anything else of a delivery note, even with quantities", () => {
    const before = read("delivery-note");
    fc.assert(
      fc.property(otherEdits(before), quantityEdits, (others, quantities) => {
        const after = edited(before, [...others, ...quantities]);
        expect(mayCorrect("counter", before, after)).toBe(false);
      }),
    );
  });

  it("a counter user may not change a delivery note into an invoice, or add or remove a line", () => {
    const before = read("delivery-note");
    expect(
      mayCorrect("counter", before, { ...before, documentType: "invoice" }),
    ).toBe(false);
    expect(
      mayCorrect("counter", before, {
        ...before,
        lines: [...before.lines, before.lines[0]!],
      }),
    ).toBe(false);
    expect(
      mayCorrect("counter", before, {
        ...before,
        lines: before.lines.slice(1),
      }),
    ).toBe(false);
    // The lines in another order are other lines: the first one's quantity isn't the first's.
    expect(
      mayCorrect("counter", before, {
        ...before,
        lines: [...before.lines].reverse(),
      }),
    ).toBe(false);
  });

  it("a counter user may correct no invoice, and no document nothing was read of", () => {
    const invoice = read("invoice");
    fc.assert(
      fc.property(quantityEdits, (edits) => {
        expect(mayCorrect("counter", invoice, edited(invoice, edits))).toBe(
          false,
        );
      }),
    );
    expect(mayCorrect("counter", null, read("delivery-note"))).toBe(false);
  });

  it("values compared as content: a draft stored as JSON, its keys in another order, is the same", () => {
    const before = read("delivery-note");
    // Postgres keeps a jsonb object's keys in its own order.
    const reversed = <T extends object>(value: T) =>
      Object.fromEntries(Object.entries(value).reverse()) as T;
    const stored = reversed({
      ...before,
      supplier: reversed(before.supplier),
      lines: before.lines.map(reversed),
    });
    expect(Object.keys(stored)).not.toEqual(Object.keys(before));
    expect(mayCorrect("counter", stored, before)).toBe(true);
  });
});
