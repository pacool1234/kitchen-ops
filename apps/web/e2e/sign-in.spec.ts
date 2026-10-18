import { expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, signIn } from "./accounts.ts";

test("the sign-in page is accessible", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectAccessible(page);
});

test("a counter user signs in and reaches the product list", async ({
  page,
}) => {
  await signIn(page, accounts.counter);
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  await expect(page.getByText("counter", { exact: false })).toBeVisible();
  await expectAccessible(page);
});
