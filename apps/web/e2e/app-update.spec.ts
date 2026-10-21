import { expect, test } from "@playwright/test";
import { accounts } from "./accounts.ts";
import { signedIn } from "./catalogue.ts";
import { openDocuments } from "./documents.ts";

// A tab left open across a deploy (#139, decision 0042). A new version waiting can't be made in
// one run: the PR has the steps to check it on staging. What can be made is the old tab's worst
// case, a page whose code the server no longer has.

// The service worker would answer from its cache, where Playwright can't fail a request. The
// page asks the server itself, as an old tab does once another tab has taken the new version
// and the old version's cache is gone.
test.use({ serviceWorkers: "block" });

test("a page whose code fails to load, as after a deploy, is loaded again and opens", async ({
  page,
}) => {
  await signedIn(page, accounts.office);
  // The documents list's code, gone the first time it's asked for.
  let failed = 0;
  await page.route(/\/assets\/DocumentsView-[^/]+\.js$/, (route) => {
    if (failed > 0) return route.fallback();
    failed += 1;
    return route.fulfill({ status: 404, body: "" });
  });

  await openDocuments(page);
  expect(failed).toBe(1);
  await expect(page).toHaveURL(/\/documents$/);
});
