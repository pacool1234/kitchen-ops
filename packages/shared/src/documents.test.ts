import { describe, expect, it } from "vitest";
import { ROLES } from "./auth";
import {
  CHECK_NAMES,
  Document,
  DocumentCheckFailure,
  seesReadingCost,
} from "./documents";

// What the document screens are sent (#106): the draft, the checks it failed by name and field,
// and what reading it cost, for the owner only.

const document = {
  id: "0199a000-0000-7000-8000-000000000001",
  status: "ready_for_review",
  failureReason: null,
  type: "delivery-note",
  supplier: null,
  number: "A-1",
  date: "2026-10-20",
  fileCount: 1,
  uploadedBy: { id: "0199a000-0000-7000-8000-000000000002", name: "Ana" },
  uploadedAt: "2026-10-20T10:00:00.000Z",
  files: [],
  draft: null,
  corrected: null,
  checkFailures: [],
  reversal: null,
  copyOf: null,
  copy: null,
};

describe("Document (#106)", () => {
  it("has no cost when it isn't the owner's to see", () => {
    expect(Document.parse(document).costMicroUsd).toBeUndefined();
    expect(
      Document.parse({ ...document, costMicroUsd: 8954 }).costMicroUsd,
    ).toBe(8954);
  });

  it("a reversed one names the document reversing it and its date; a corrected copy and its original name each other (#119)", () => {
    const reversed = {
      ...document,
      status: "posted",
      reversal: {
        id: "0199a000-0000-7000-8000-000000000003",
        date: "2026-10-21",
      },
      copy: "0199a000-0000-7000-8000-000000000004",
    };
    expect(Document.parse(reversed)).toEqual(reversed);
    const copied = { ...document, copyOf: reversed.id };
    expect(Document.parse(copied)).toEqual(copied);
    expect(
      Document.safeParse({ ...document, reversal: { id: "x", date: "today" } })
        .success,
    ).toBe(false);
  });

  it("a check failure is a known check and a field: never the check's own message, which may quote the document", () => {
    expect(
      DocumentCheckFailure.parse({ check: "total", path: "totals.total" }),
    ).toEqual({ check: "total", path: "totals.total" });
    expect(() =>
      DocumentCheckFailure.parse({ check: "spelling", path: "number" }),
    ).toThrow();
    expect(() =>
      DocumentCheckFailure.parse({
        check: "total",
        path: "totals.total",
        message: "63.80 isn't 1.00",
      }),
    ).toThrow();
  });

  it("names every check the extraction runs", () => {
    expect(CHECK_NAMES).toEqual([
      "missing-value",
      "line-total",
      "lines-sum",
      "vat",
      "total",
      "tax-id",
      "date",
      "duplicate",
    ]);
  });
});

describe("seesReadingCost: costs are the owner's (spec section 6)", () => {
  it("only the owner sees what reading a document cost", () => {
    expect(ROLES.filter(seesReadingCost)).toEqual(["owner"]);
  });
});
