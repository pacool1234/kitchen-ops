import { expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, signIn } from "./accounts.ts";

test("the product list shows the seed's active products, not the inactive one", async ({
  page,
}) => {
  await signIn(page, accounts.counter);
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  const list = page.getByRole("list");
  for (const name of ["Tomato", "Olive oil", "Eggs"]) {
    await expect(list.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(list.getByRole("listitem")).toHaveCount(7);
  await expect(page.getByText("Saffron (discontinued)")).toHaveCount(0);
  await expectAccessible(page);
});

test("signed out, the product list sends you to sign in", async ({ page }) => {
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
