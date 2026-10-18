import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts } from "./accounts.ts";
import {
  arrivedAt,
  choose,
  openCatalogue,
  signedIn,
  unique,
} from "./catalogue.ts";

// Storerooms in the catalogue (#89): the office creates, edits and deactivates them, and counter
// staff read them. At desktop and phone sizes, with axe on every screen.

const title = (page: Page) => page.getByRole("heading", { level: 1 });
// Reka names the notices' region with its key too: "Avisos (F8)".
const toast = (page: Page, text: string) =>
  page
    .getByRole("region", { name: /^Avisos/ })
    .getByText(text, { exact: true });

test("office creates a storeroom, edits it and deactivates it; a name taken is refused on its field", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  await openCatalogue(page, "Almacenes");
  await expect(
    page.getByRole("link", { name: "Cámara frigorífica" }),
  ).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Nuevo almacén" }).click();
  await arrivedAt(page, "Nuevo almacén");
  // A name another storeroom has, whatever its case: only the API can tell.
  await page.getByLabel("Nombre").fill("barra");
  await choose(page, "Tipo", "Barra");
  await page.getByRole("button", { name: "Crear almacén" }).click();
  await expect(
    page.getByText("Ya hay un almacén con este nombre."),
  ).toBeVisible();

  const name = unique(testInfo, "Terraza");
  await page.getByLabel("Nombre").fill(name);
  await page.getByRole("button", { name: "Crear almacén" }).click();
  await expect(toast(page, "Almacén creado")).toBeVisible();
  await arrivedAt(page, name);
  await expectAccessible(page);

  await choose(page, "Tipo", "Almacén seco");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(toast(page, "Cambios guardados")).toBeVisible();

  // The list filters by type.
  await page
    .getByRole("navigation", { name: "Estás en" })
    .getByRole("link", { name: "Almacenes" })
    .click();
  await arrivedAt(page, "Almacenes");
  await choose(page, "Tipo", "Almacén seco");
  await expect(page.getByRole("link", { name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Barra" })).toHaveCount(0);

  await page.getByRole("link", { name }).click();
  await page.getByRole("button", { name: "Desactivar" }).click();
  await page
    .getByRole("dialog", { name: `¿Desactivar ${name}?` })
    .getByRole("button", { name: "Desactivar" })
    .click();
  await expect(toast(page, "Almacén desactivado")).toBeVisible();
  await expect(page.getByText("Inactivo", { exact: true })).toBeVisible();
});

test("counter staff read the storerooms, and can't change them", async ({
  page,
}) => {
  await signedIn(page, accounts.counter);
  await openCatalogue(page, "Almacenes");
  await expect(page.getByRole("link", { name: "Nuevo almacén" })).toHaveCount(
    0,
  );
  await expectAccessible(page);

  await page.getByRole("link", { name: "Almacén seco" }).click();
  await expect(title(page)).toHaveText("Almacén seco");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Guardar cambios" }),
  ).toHaveCount(0);
  await expectAccessible(page);
});
