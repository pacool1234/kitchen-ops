import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// WCAG 2.2 AA (spec section 11.2), as axe tags its rules: every level up to AA, every version.
const WCAG_AA = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
];

/**
 * Waits for the colour transitions running now to end (#127): axe measures contrast as it is at
 * that moment, and halfway between the light and dark themes it's neither one's. Endless
 * animations, a spinner or a skeleton's pulse, would never end, so they aren't waited for.
 */
async function transitionsEnded(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        // A transition cancelled before it ends rejects: it isn't running any more either.
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/** Fails the test on any WCAG 2.2 AA violation axe finds on the page, once it's settled. */
export async function expectAccessible(page: Page): Promise<void> {
  await transitionsEnded(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_AA)
    // While a notice shows, Reka puts a focus sentinel on each side of the notices' region:
    // hidden from screen readers but focusable, by design, so Tab moves focus into the notices
    // and out again (Radix does the same). axe's aria-hidden-focus rule flags them; nothing
    // else is left out.
    .exclude('[role="region"] > span[aria-hidden="true"][tabindex="0"]')
    .analyze();
  // Each violation as its rule and the elements it found, so a failure says what to fix.
  const found = violations.map(
    (v) =>
      `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
  expect(found, "accessibility violations").toEqual([]);
}
