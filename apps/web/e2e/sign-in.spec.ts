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

test("an office user signs in too", async ({ page }) => {
  await signIn(page, accounts.office);
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  await expect(page.getByText("office", { exact: false })).toBeVisible();
});

test("a wrong password stays on the sign-in page, with an error that is announced", async ({
  page,
}) => {
  await signIn(page, { ...accounts.counter, password: "not-the-password" });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectAccessible(page);
});

test("signing out returns to the sign-in page, and the products are closed again", async ({
  page,
}) => {
  await signIn(page, accounts.counter);
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
