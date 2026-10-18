import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  compareDecimal,
  nextSort,
  pageBounds,
  pageCount,
  pageRows,
  sortRows,
  type SortColumn,
} from "./table";

describe("nextSort: what clicking a column's header does", () => {
  it("a new column sorts ascending, then each click flips it", () => {
    expect(nextSort(null, "name")).toEqual({ key: "name", direction: "asc" });
    expect(nextSort({ key: "name", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "desc",
    });
    expect(nextSort({ key: "name", direction: "desc" }, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
    expect(nextSort({ key: "name", direction: "desc" }, "cost")).toEqual({
      key: "cost",
      direction: "asc",
    });
  });
});

describe("paging", () => {
  it("counts pages, and an empty table still has one page", () => {
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(95, 10)).toBe(10);
    expect(pageCount(100, 10)).toBe(10);
    expect(pageCount(101, 10)).toBe(11);
  });

  it("says which rows a page shows, counting from 1: 21–40 of 95", () => {
    expect(pageBounds(2, 20, 95)).toEqual({ first: 21, last: 40 });
    expect(pageBounds(5, 20, 95)).toEqual({ first: 81, last: 95 });
    expect(pageBounds(1, 20, 0)).toEqual({ first: 0, last: 0 });
  });

  it("any rows and page size: the pages, one after another, are exactly the rows", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 200 }),
        fc.integer({ min: 1, max: 50 }),
        (rows, size) => {
          const pages = Array.from(
            { length: pageCount(rows.length, size) },
            (_, i) => pageRows(rows, i + 1, size),
          );
          expect(pages.flat()).toEqual(rows);
          // Every page is full except the last.
          for (const page of pages.slice(0, -1))
            expect(page).toHaveLength(size);
          // And what pageBounds says matches what the page holds.
          pages.forEach((page, i) => {
            const { first, last } = pageBounds(i + 1, size, rows.length);
            expect(page.length).toBe(rows.length === 0 ? 0 : last - first + 1);
          });
        },
      ),
    );
  });
});

describe("compareDecimal: ordering decimal strings exactly, like amounts from the API", () => {
  it("orders by value, whatever the number of decimals", () => {
    expect(compareDecimal("2.5", "10")).toBeLessThan(0);
    expect(compareDecimal("2.50", "2.5")).toBe(0);
    expect(compareDecimal("-3", "-2.99")).toBeLessThan(0);
    expect(compareDecimal("0.001", "0")).toBeGreaterThan(0);
  });

  it("stays exact beyond 2^53, where numbers would call these equal", () => {
    expect(
      compareDecimal("9007199254740993", "9007199254740992"),
    ).toBeGreaterThan(0);
  });

  it("any two decimals: the same order as their whole thousandths", () => {
    const thousandths = fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n });
    const text = (units: bigint) => {
      const digits = (units < 0n ? -units : units).toString().padStart(4, "0");
      return `${units < 0n ? "-" : ""}${digits.slice(0, -3)}.${digits.slice(-3)}`;
    };
    fc.assert(
      fc.property(thousandths, thousandths, (a, b) => {
        expect(Math.sign(compareDecimal(text(a), text(b)))).toBe(
          a === b ? 0 : a < b ? -1 : 1,
        );
      }),
    );
  });
});

describe("sortRows: a table's rows in a column's order", () => {
  interface Row {
    name: string;
    cost: string;
  }
  const columns: SortColumn<Row>[] = [
    { key: "name", sortAs: "text", value: (row) => row.name },
    { key: "cost", sortAs: "decimal", value: (row) => row.cost },
  ];
  const rows: Row[] = [
    { name: "oliva", cost: "10.5" },
    { name: "Ñora", cost: "2.25" },
    { name: "nabo", cost: "100" },
    { name: "Limón", cost: "2.3" },
  ];

  it("text in Spanish order: ñ after n, and capitals and accents don't push a word apart", () => {
    const sorted = sortRows(
      rows,
      { key: "name", direction: "asc" },
      columns,
      "es",
    );
    expect(sorted.map((r) => r.name)).toEqual([
      "Limón",
      "nabo",
      "Ñora",
      "oliva",
    ]);
  });

  it("amounts by value, not as text: 2.25 < 2.3 < 10.5 < 100", () => {
    const sorted = sortRows(
      rows,
      { key: "cost", direction: "asc" },
      columns,
      "es",
    );
    expect(sorted.map((r) => r.cost)).toEqual(["2.25", "2.3", "10.5", "100"]);
  });

  it("no sort keeps the rows as they came, and sorting never changes the array it's given", () => {
    const copy = [...rows];
    expect(sortRows(rows, null, columns, "es")).toEqual(rows);
    sortRows(rows, { key: "cost", direction: "desc" }, columns, "es");
    expect(rows).toEqual(copy);
  });

  it("any rows: descending is ascending reversed, when the values differ", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), {
          maxLength: 50,
        }),
        (values) => {
          const data = values.map((v) => ({ name: String(v), cost: `${v}.5` }));
          const asc = sortRows(
            data,
            { key: "cost", direction: "asc" },
            columns,
            "es",
          );
          const desc = sortRows(
            data,
            { key: "cost", direction: "desc" },
            columns,
            "es",
          );
          expect(desc).toEqual([...asc].reverse());
        },
      ),
    );
  });
});
