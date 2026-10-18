import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import tokensCss from "./tokens.css?raw";

/** Every colour token as [name, light, dark], from `--color-name: light-dark(#light, #dark)`. */
function colourTokens(): Map<string, { light: string; dark: string }> {
  const tokens = new Map<string, { light: string; dark: string }>();
  for (const match of tokensCss.matchAll(
    /--color-([\w-]+):\s*light-dark\(\s*(#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\s*\)/gi,
  )) {
    tokens.set(match[1]!, { light: match[2]!, dark: match[3]! });
  }
  return tokens;
}

// What WCAG 2.2 AA asks: 4.5:1 for text (1.4.3), 3:1 for the parts of a control people need to
// see, such as a field's border or the focus ring (1.4.11).
const TEXT = 4.5;
const UI = 3;

/** [foreground, background, minimum]: every pair the components put together. */
const PAIRS: [string, string, number][] = [
  ...["canvas", "surface", "surface-muted"].flatMap(
    (bg): [string, string, number][] => [
      ["fg", bg, TEXT],
      ["fg-muted", bg, TEXT],
      ["primary", bg, TEXT],
      ["danger", bg, TEXT],
      ["line-strong", bg, UI],
      ["focus", bg, UI],
    ],
  ),
  ["on-primary", "primary", TEXT],
  ["on-primary", "primary-hover", TEXT],
  ["primary", "primary-soft", TEXT],
  ["fg", "primary-soft", TEXT],
  ["on-danger", "danger", TEXT],
  ["on-danger", "danger-hover", TEXT],
  ["danger", "danger-soft", TEXT],
  ["warning", "warning-soft", TEXT],
  ["success", "success-soft", TEXT],
  ["info", "info-soft", TEXT],
  ["warning", "surface", TEXT],
  ["success", "surface", TEXT],
  ["info", "surface", TEXT],
  ["focus", "primary-soft", UI],
];

describe("contrastRatio: WCAG's contrast between two colours", () => {
  it("black on white is 21:1, and a colour on itself is 1:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#1f5135", "#1f5135")).toBe(1);
  });

  it("matches a known pair: #767676 on white is 4.54:1, the lightest grey that passes", () => {
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("any two colours: the same either way round, and between 1 and 21", () => {
    const colour = fc
      .integer({ min: 0, max: 0xffffff })
      .map((n) => `#${n.toString(16).padStart(6, "0")}`);
    fc.assert(
      fc.property(colour, colour, (a, b) => {
        const ratio = contrastRatio(a, b);
        expect(ratio).toBe(contrastRatio(b, a));
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(21);
      }),
    );
  });
});

describe("the design tokens (#85)", () => {
  const tokens = colourTokens();

  it("every colour is defined for light and dark, as hex, so this test sees it", () => {
    const declared = [...tokensCss.matchAll(/--color-([\w-]+):/g)].map(
      (m) => m[1]!,
    );
    // The dialog's backdrop is translucent: it's never text or a control's edge.
    const checked = declared.filter(
      (name) => name !== "overlay" && name !== "*",
    );
    expect(checked.length).toBeGreaterThan(15);
    expect(checked.filter((name) => !tokens.has(name))).toEqual([]);
  });

  it("every pair the components use meets WCAG 2.2 AA, in light and in dark", () => {
    const failures: string[] = [];
    for (const theme of ["light", "dark"] as const) {
      for (const [fg, bg, minimum] of PAIRS) {
        const ratio = contrastRatio(
          tokens.get(fg)![theme],
          tokens.get(bg)![theme],
        );
        if (ratio < minimum) {
          failures.push(
            `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("every pair names tokens that exist", () => {
    const missing = PAIRS.flatMap(([fg, bg]) => [fg, bg]).filter(
      (name) => !tokens.has(name),
    );
    expect(missing).toEqual([]);
  });
});
