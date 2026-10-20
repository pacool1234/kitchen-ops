import { DOCUMENT_STATUSES } from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  failureLine,
  inProgress,
  readDocumentQuery,
  writeDocumentQuery,
} from "./list";

// The documents list's filter and page live in the URL (#106), like the catalogue's lists, and
// the list keeps checking while any document shown is still being read.

describe("readDocumentQuery and writeDocumentQuery", () => {
  it("an empty URL is every status, page 1, and writes nothing", () => {
    expect(readDocumentQuery({})).toEqual({ status: "", page: 1 });
    expect(writeDocumentQuery({ status: "", page: 1 })).toEqual({});
  });

  it("a status it doesn't know, or a page that isn't one, is the default", () => {
    expect(readDocumentQuery({ status: "posted", page: "0" })).toEqual({
      status: "",
      page: 1,
    });
    expect(readDocumentQuery({ status: "failed", page: "2.5" })).toEqual({
      status: "failed",
      page: 1,
    });
  });

  it("any state reads back as itself", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("" as const, ...DOCUMENT_STATUSES),
        fc.integer({ min: 1, max: 10_000 }),
        (status, page) => {
          const query = writeDocumentQuery({ status, page });
          const asStrings = Object.fromEntries(
            Object.entries(query).map(([k, v]) => [k, String(v)]),
          );
          expect(readDocumentQuery(asStrings)).toEqual({ status, page });
        },
      ),
    );
  });
});

describe("inProgress: whether anything shown is still waiting or being read", () => {
  it("queued or reading: yes; ready for review or failed: no", () => {
    expect(inProgress([])).toBe(false);
    expect(
      inProgress([{ status: "ready_for_review" }, { status: "failed" }]),
    ).toBe(false);
    expect(inProgress([{ status: "failed" }, { status: "queued" }])).toBe(true);
    expect(inProgress([{ status: "reading" }])).toBe(true);
  });
});

describe("failureLine: which line a failed check is on, counted from 1", () => {
  it("a line's field: its line; anything else: none", () => {
    expect(failureLine("lines.0.lineTotal")).toBe(1);
    expect(failureLine("lines.3.unitPrice")).toBe(4);
    expect(failureLine("lines.11")).toBe(12);
    expect(failureLine("totals.total")).toBeNull();
    expect(failureLine("number")).toBeNull();
    expect(failureLine("supplier.taxId")).toBeNull();
  });
});
