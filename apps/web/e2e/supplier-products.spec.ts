import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts } from "./accounts.ts";
import {
  arrivedAt,
  createSupplier,
  loadedAt,
  signedIn,
  syntheticCif,
  unique,
} from "./catalogue.ts";

// Supplier products (#89): on a supplier's page, the office maps the supplier's code and pack to
// one of our products, found by typing; counter staff read them. Desktop and phone, with axe.

// Reka names the notices' region with its key too: "Avisos (F8)".
const toast = (page: Page, text: string) =>
  page
    .getByRole("region", { name: /^Avisos/ })
    .getByText(text, { exact: true });
const section = (page: Page) =>
  page.getByRole("region", { name: "Productos de este proveedor" });

test("office maps a supplier's product to ours through the picker, then edits and deactivates it", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const name = unique(testInfo, "Hortalizas Vega");
  const { id } = await createSupplier(page, { name, taxId: syntheticCif() });
  await page.goto(`/catalogue/suppliers/${id}`);
  await loadedAt(page, name);
  await expect(
    section(page).getByText("Este proveedor aún no tiene productos"),
  ).toBeVisible();

  await section(page).getByRole("button", { name: "Añadir producto" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Añadir producto del proveedor",
  });
  await dialog.getByLabel("Código del proveedor").fill("TP-6");
  await dialog.getByLabel("Descripción").fill("Tomate pera extra, caja 6 kg");

  // Found by typing, without its accent or capitals: the API searches.
  await dialog
    .getByRole("combobox", { name: "Nuestro producto" })
    .fill("tomate p");
  await page.getByRole("option", { name: "Tomate pera", exact: true }).click();
  // The product's units: its base unit first, then its purchase units, smallest first.
  await page.getByRole("combobox", { name: "Unidad del envase" }).click();
  await expect(page.getByRole("option")).toHaveText(["g", "kg", "caja"]);
  await page.getByRole("option", { name: "caja", exact: true }).click();
  await dialog.getByLabel("Cantidad").fill("1");
  await expect(dialog.getByText("1 caja = 6 kg")).toBeVisible();
  await expectAccessible(page);

  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(toast(page, "Producto añadido")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(
    section(page).getByText("Tomate pera extra, caja 6 kg"),
  ).toBeVisible();

  // The product's page lists who sells it.
  await section(page).getByRole("link", { name: "Tomate pera" }).click();
  await arrivedAt(page, "Tomate pera");
  await expect(page.getByRole("link", { name })).toBeVisible();
  await page.goBack();
  await arrivedAt(page, name);

  // Editing: a code the supplier already uses would be refused; deactivating is a tick box.
  await section(page).getByRole("button", { name: "Editar TP-6" }).click();
  const edit = page.getByRole("dialog", { name: "Editar TP-6" });
  await edit.getByLabel("Activo").uncheck();
  await edit.getByRole("button", { name: "Guardar" }).click();
  await expect(toast(page, "Cambios guardados")).toBeVisible();
  await expect(
    section(page).getByText("Inactivo", { exact: true }),
  ).toBeVisible();
});

test("closing the dialog with changes asks first", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const name = unique(testInfo, "Frutos Secos Llano");
  const { id } = await createSupplier(page, { name, taxId: syntheticCif() });
  await page.goto(`/catalogue/suppliers/${id}`);
  await loadedAt(page, name);

  await section(page).getByRole("button", { name: "Añadir producto" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Añadir producto del proveedor",
  });
  await dialog.getByLabel("Código del proveedor").fill("NUE-1");
  await page.keyboard.press("Escape");
  const ask = page.getByRole("dialog", { name: "¿Salir sin guardar?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Seguir editando" }).click();
  await expect(dialog.getByLabel("Código del proveedor")).toHaveValue("NUE-1");

  await page.keyboard.press("Escape");
  await ask.getByRole("button", { name: "Salir sin guardar" }).click();
  await expect(dialog).toHaveCount(0);
});

test("counter staff read a supplier's products, and can't add or edit them", async ({
  page,
}) => {
  await signedIn(page, accounts.counter);
  await page.goto("/catalogue/suppliers");
  await loadedAt(page, "Proveedores");
  await page.getByRole("link", { name: "Lácteos La Pradera, S.L." }).click();
  await arrivedAt(page, "Lácteos La Pradera, S.L.");
  await expect(
    section(page).getByText("Huevos camperos, docena"),
  ).toBeVisible();
  await expect(
    section(page).getByRole("button", { name: "Añadir producto" }),
  ).toHaveCount(0);
  await expect(
    section(page).getByRole("button", { name: /^Editar/ }),
  ).toHaveCount(0);
  await expectAccessible(page);
});
