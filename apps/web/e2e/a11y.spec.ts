import { expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";

// The check itself: with every real page passing, a check that never fails would go unnoticed.
test("the accessibility check fails on a page with a violation, naming the rule", async ({
  page,
}) => {
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>t</title></head><body><main><img src="data:,"></main></body></html>',
  );
  await expect(expectAccessible(page)).rejects.toThrow("image-alt");
});

test("and passes once it's fixed", async ({ page }) => {
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>t</title></head><body><main><img src="data:," alt="A test image"></main></body></html>',
  );
  await expectAccessible(page);
});
