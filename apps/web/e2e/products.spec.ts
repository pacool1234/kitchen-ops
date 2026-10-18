import { expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, signIn } from "./accounts.ts";
import { mainNav } from "./shell.ts";

test("the product list shows the seed's active products, not the inactive one", async ({
  page,
}) => {
  await signIn(page, accounts.counter);
  await mainNav(page).getByRole("link", { name: "Productos" }).click();
  await expect(page.getByRole("heading", { name: "Productos" })).toBeVisible();

  const table = page.getByRole("table", { name: "Productos activos" });
  for (const name of ["Tomato", "Olive oil", "Eggs"]) {
    await expect(table.getByRole("cell", { name, exact: true })).toBeVisible();
  }
  // The header row, and the seed's 7 active products.
  await expect(table.getByRole("row")).toHaveCount(8);
  await expect(page.getByText("Saffron (discontinued)")).toHaveCount(0);
  await expectAccessible(page);
});

test("signed out, the product list sends you to sign in", async ({ page }) => {
  await page.goto("/products");
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
});
