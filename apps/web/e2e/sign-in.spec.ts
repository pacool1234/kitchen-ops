import { expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, signIn } from "./accounts.ts";
import { signOut } from "./shell.ts";

test("the sign-in page is accessible", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("a counter user signs in and reaches the home page, greeted by name", async ({
  page,
}) => {
  await signIn(page, accounts.counter);
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
  await expect(page.getByText("Hola, Local counter")).toBeVisible();
  await expectAccessible(page);
});

test("an office user signs in too", async ({ page }) => {
  await signIn(page, accounts.office);
  await expect(page.getByText("Hola, Local office")).toBeVisible();
});

test("a wrong password stays on the sign-in page, with an error that is announced", async ({
  page,
}) => {
  await signIn(page, { ...accounts.counter, password: "not-the-password" });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("signing out returns to the sign-in page, and the products are closed again", async ({
  page,
}) => {
  await signIn(page, accounts.counter);
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
  await signOut(page);
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
  await page.goto("/products");
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
});
