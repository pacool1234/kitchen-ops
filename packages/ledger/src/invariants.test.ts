/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M2 is done when "all invariants in section 4 are covered by property-based tests" (spec
// section 9). This file checks it on every test run, instead of a PR claiming it: it reads the
// ledger's test files as text and looks for property tests named after each invariant.

/**
 * The labels a property test must start with, one per invariant in spec section 4. Invariant 5
 * is "the same stock and cost", so its cost half has a label of its own.
 */
const REQUIRED = [
  "invariant 1",
  "invariant 2",
  "invariant 3",
  "invariant 4",
  "invariant 5",
  "invariant 5 (cost)",
  "invariant 6",
  "invariant 7",
];

interface FoundTest {
  readonly file: string;
  readonly name: string;
  /** "invariant 5 (cost)" for "invariant 5 (cost): …", or undefined for any other test. */
  readonly label: string | undefined;
  /** Whether the test calls fc.assert, i.e. checks a property rather than examples. */
  readonly isProperty: boolean;
}

/**
 * Every `it("…")` in a test file's source, with its name and whether its body calls fc.assert.
 * A test's body is everything up to the next `it(`. Names may be on the line after `it(`, where
 * Prettier puts long ones.
 */
function testsIn(file: string, source: string): FoundTest[] {
  const starts = [...source.matchAll(/\bit\(\s*"((?:[^"\\]|\\.)*)"/g)];
  return starts.map((match, i) => {
    const name = match[1] ?? "";
    const body = source.slice(match.index, starts[i + 1]?.index);
    return {
      file,
      name,
      label: /^(invariant \d+(?: \(cost\))?):/.exec(name)?.[1],
      isProperty: body.includes("fc.assert("),
    };
  });
}

const sourceDirectory = new URL(".", import.meta.url);
const ownFile = "invariants.test.ts";
const found = readdirSync(sourceDirectory)
  .filter((file) => file.endsWith(".test.ts") && file !== ownFile)
  .flatMap((file) =>
    testsIn(file, readFileSync(new URL(file, sourceDirectory), "utf8")),
  );
const invariantTests = found.filter((t) => t.label !== undefined);

describe("every ledger invariant is covered by a property test (spec section 9, M2)", () => {
  it("each invariant in spec section 4 has a property test named `invariant N: …`", () => {
    const missing = REQUIRED.filter(
      (label) => !invariantTests.some((t) => t.label === label && t.isProperty),
    );
    expect(missing).toEqual([]);
  });

  it("every test named after an invariant is a property test: it calls fc.assert", () => {
    const examplesOnly = invariantTests
      .filter((t) => !t.isProperty)
      .map((t) => `${t.file}: ${t.name}`);
    expect(examplesOnly).toEqual([]);
  });

  it("the README lists every invariant test by its exact name, and no test that doesn't exist", () => {
    const readme = readFileSync(
      new URL("../README.md", sourceDirectory),
      "utf8",
    );
    // Test names are quoted in backticks in the README's table.
    const listed = [...readme.matchAll(/`(invariant \d+[^`]*)`/g)].map(
      (m) => m[1],
    );
    const names = invariantTests.map((t) => t.name);
    expect(listed.filter((name) => !names.includes(name ?? ""))).toEqual([]);
    expect(names.filter((name) => !listed.includes(name))).toEqual([]);
  });
});

describe("testsIn: finding tests in a file's source", () => {
  it("finds names on the same line as it(, and on the next line, where Prettier puts long ones", () => {
    const source = [
      'it("invariant 1: short", () => {',
      "  fc.assert(fc.property(fc.nat(), () => true));",
      "});",
      "it(",
      '  "invariant 5 (cost): a name too long for one line",',
      "  () => {",
      "    fc.assert(fc.property(fc.nat(), () => true));",
      "  },",
      ");",
    ].join("\n");
    expect(testsIn("a.test.ts", source)).toEqual([
      {
        file: "a.test.ts",
        name: "invariant 1: short",
        label: "invariant 1",
        isProperty: true,
      },
      {
        file: "a.test.ts",
        name: "invariant 5 (cost): a name too long for one line",
        label: "invariant 5 (cost)",
        isProperty: true,
      },
    ]);
  });

  it("a test without fc.assert isn't a property test, even if the next one is", () => {
    const source = [
      'it("invariant 2: only an example", () => {',
      "  expect(1).toBe(1);",
      "});",
      'it("invariant 3: a property", () => {',
      "  fc.assert(fc.property(fc.nat(), () => true));",
      "});",
    ].join("\n");
    expect(
      testsIn("b.test.ts", source).map((t) => [t.label, t.isProperty]),
    ).toEqual([
      ["invariant 2", false],
      ["invariant 3", true],
    ]);
  });

  it("other tests have no label, and escaped quotes stay in the name", () => {
    const source =
      'it("rejects \\"crate\\"", () => {});\nit("invariant x", () => {});';
    expect(testsIn("c.test.ts", source)).toMatchObject([
      { name: 'rejects \\"crate\\"', label: undefined },
      { name: "invariant x", label: undefined },
    ]);
  });
});
