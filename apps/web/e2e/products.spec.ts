import { expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, signIn } from "./accounts.ts";
import { mainNav } from "./shell.ts";

test("the product list shows the seed's active products a page at a time, in Spanish order, without the discontinued one", async ({
  page,
}) => {
  await signIn(page, accounts.counter);
  await mainNav(page).getByRole("link", { name: "Productos" }).click();
  await expect(page.getByRole("heading", { name: "Productos" })).toBeVisible();

  // The seed has 43 active products: pages of 20, 20 and 3.
  const table = page.getByRole("table", { name: "Productos activos" });
  const pages = page.getByRole("navigation", { name: "Páginas" });
  const cell = (name: string) => table.getByRole("cell", { name, exact: true });
  await expect(table.getByRole("row")).toHaveCount(21);
  await expect(table.getByRole("row").nth(1)).toContainText(
    "Aceite de oliva virgen extra",
  );
  await expect(cell("Lechuga romana")).toBeVisible();
  await expect(pages.getByText("1–20 de 43")).toBeVisible();

  await pages.getByRole("button", { name: "Página siguiente" }).click();
  await expect(cell("Limones")).toBeVisible();
  await expect(cell("Aceite de oliva virgen extra")).toHaveCount(0);
  await expect(pages.getByText("21–40 de 43")).toBeVisible();

  await pages.getByRole("button", { name: "Página siguiente" }).click();
  await expect(cell("Vino tinto Rioja crianza")).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(page.getByText("Azafrán en hebra (descatalogado)")).toHaveCount(
    0,
  );
  await expectAccessible(page);
});

test("signed out, the product list sends you to sign in", async ({ page }) => {
  await page.goto("/products");
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
});
