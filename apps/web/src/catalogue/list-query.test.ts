import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  changeList,
  latestOnly,
  readListQuery,
  writeListQuery,
  type ListState,
} from "./list-query";

// A catalogue list's search, filters and page live in the URL (#89), so the back button and a
// refresh keep them. Only what differs from the defaults is written.

describe("readListQuery and writeListQuery", () => {
  it("an empty URL is the defaults: no search, the active rows, page 1", () => {
    expect(readListQuery({}, ["type"])).toEqual({
      q: "",
      status: "active",
      page: 1,
      filters: { type: "" },
    });
    expect(writeListQuery(readListQuery({}, ["type"]))).toEqual({});
  });

  it("reads what the URL says, and writes only what isn't a default", () => {
    const state = readListQuery(
      { q: "huerto", status: "all", page: "3", type: "bar", other: "x" },
      ["type"],
    );
    expect(state).toEqual({
      q: "huerto",
      status: "all",
      page: 3,
      filters: { type: "bar" },
    });
    expect(writeListQuery(state)).toEqual({
      q: "huerto",
      status: "all",
      page: "3",
      type: "bar",
    });
  });

  it("a URL it can't read falls back to the defaults, not to an error", () => {
    expect(
      readListQuery({ status: "gone", page: "-2", q: ["a", "b"] }, []),
    ).toEqual({ q: "a", status: "active", page: 1, filters: {} });
    expect(readListQuery({ page: "2.5" }, []).page).toBe(1);
  });

  it("any state written and read back is the same state", () => {
    const state = fc.record({
      q: fc.string(),
      status: fc.constantFrom("active", "inactive", "all" as const),
      page: fc.integer({ min: 1, max: 10_000 }),
      filters: fc.record({ type: fc.string(), storeroomId: fc.string() }),
    });
    fc.assert(
      fc.property(state, (s) => {
        const query = writeListQuery(s);
        const asUrl = Object.fromEntries(
          Object.entries(query).map(([k, v]) => [k, String(v)]),
        );
        expect(readListQuery(asUrl, ["type", "storeroomId"])).toEqual(s);
      }),
    );
  });
});

describe("changeList: a new search or filter goes back to page 1", () => {
  const onPage3: ListState = {
    q: "tom",
    status: "active",
    page: 3,
    filters: { type: "bar", storeroomId: "" },
  };

  it("a new search, status or filter starts again at page 1", () => {
    expect(changeList(onPage3, { q: "tomate" })).toMatchObject({
      q: "tomate",
      page: 1,
    });
    expect(changeList(onPage3, { status: "all" })).toMatchObject({ page: 1 });
    expect(changeList(onPage3, { filters: { type: "cold_room" } })).toEqual({
      ...onPage3,
      page: 1,
      filters: { type: "cold_room", storeroomId: "" },
    });
  });

  it("a change of page keeps everything else", () => {
    expect(changeList(onPage3, { page: 4 })).toEqual({ ...onPage3, page: 4 });
  });
});

describe("latestOnly: a late answer never replaces a newer one", () => {
  const later = <T>(value: T, ms: number) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

  it("the first of two searches answers last: it's stale, and the second is kept", async () => {
    const latest = latestOnly();
    const first = latest(() => later("tom", 30));
    const second = latest(() => later("tomate", 5));
    expect(await second).toEqual({ stale: false, value: "tomate" });
    expect(await first).toEqual({ stale: true });
  });

  it("an answer that comes while it's still the latest is kept", async () => {
    const latest = latestOnly();
    expect(await latest(() => later(1, 1))).toEqual({ stale: false, value: 1 });
    expect(await latest(() => later(2, 1))).toEqual({ stale: false, value: 2 });
  });

  it("the latest one's error is thrown; a stale one's is ignored", async () => {
    const latest = latestOnly();
    const old = latest(() => Promise.reject(new Error("old")));
    const current = latest(() => Promise.reject(new Error("current")));
    await expect(old).resolves.toEqual({ stale: true });
    await expect(current).rejects.toThrow("current");
  });
});
