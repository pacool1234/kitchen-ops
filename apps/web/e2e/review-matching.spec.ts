import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts } from "./accounts.ts";
import { signedIn, syntheticCif, unique } from "./catalogue.ts";
import { settled, textPdf, uploadPdf } from "./documents.ts";

// The supplier and each line's product, in review (#118, decisions 0035 and 0036): chosen, or
// created on the spot, and confirmed once. The fake model reads a delivery note from
// B00000018, which no supplier has: a test that creates a supplier gives it a tax ID of its
// own, or every later document would be that supplier's, and its number a duplicate.

test.setTimeout(90_000);

/** Uploads a PDF the fake model reads, waits for it, and opens its page. */
async function readDocument(page: Page, label: string): Promise<string> {
  const uploaded = await uploadPdf(
    page,
    textPdf(`${label}: un albaran de prueba sin nada raro`),
  );
  await settled(page, uploaded.id);
  await page.goto(`/documents/${uploaded.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Albarán ALB-0001",
  );
  return uploaded.id;
}

const left = (page: Page) =>
  page.getByRole("region", { name: "Antes de registrarlo" });
const supplier = (page: Page) =>
  page.getByRole("region", { name: "Proveedor" });
const line = (page: Page, n: number) =>
  page.getByRole("group", { name: `Línea ${n}`, exact: true });
// Reka names the notices' region with its key too: "Avisos (F8)".
const toast = (page: Page, text: string) =>
  page
    .getByRole("region", { name: /^Avisos/ })
    .getByText(text, { exact: true });

/** Confirms a line's suggested product with this pack. */
async function confirmSuggestion(
  page: Page,
  n: number,
  pack: { quantity: string; unit: string },
) {
  await line(page, n)
    .getByRole("button", { name: "Confirmar el producto" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Producto de la línea ${n}`,
  });
  await dialog.getByLabel("Cantidad").fill(pack.quantity);
  await dialog.getByRole("combobox", { name: "Unidad del envase" }).click();
  await page.getByRole("option", { name: pack.unit, exact: true }).click();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  // The last line's may still show: one of them.
  await expect(toast(page, "Producto confirmado").first()).toBeVisible();
  await expect(dialog).toHaveCount(0);
}

test("a supplier created on the spot from what was read, and each line's suggested product confirmed: only the new supplier's note is left", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  await readDocument(page, unique(testInfo, "Albaran de un proveedor nuevo"));

  // A tax ID of its own (see above), corrected and saved.
  const taxId = syntheticCif();
  await page.getByRole("textbox", { name: "NIF/CIF" }).fill(taxId);
  await page.getByRole("button", { name: "Guardar correcciones" }).click();
  await expect(toast(page, "Correcciones guardadas")).toBeVisible();

  await expect(left(page)).toContainText("Falta el proveedor.");
  await expect(left(page)).toContainText("Hay líneas sin producto confirmado.");
  await expect(supplier(page)).toContainText(
    "Ningún proveedor tiene el NIF/CIF leído.",
  );
  // No product can be chosen before the supplier.
  await expect(line(page, 1)).toContainText("Sugerido: Tomate pera");
  await expect(
    line(page, 1).getByRole("button", { name: "Confirmar el producto" }),
  ).toBeDisabled();
  await expect(line(page, 1)).toContainText("Elige antes el proveedor.");
  await expectAccessible(page);

  // Created from what was read: its name and tax ID are there already.
  await supplier(page).getByRole("button", { name: "Crear proveedor" }).click();
  const create = page.getByRole("dialog", { name: "Crear proveedor" });
  await expect(create.getByLabel("Nombre")).toHaveValue(
    "Distribuciones de Ejemplo, S.L.",
  );
  await expect(create.getByLabel("NIF/CIF")).toHaveValue(taxId);
  await expectAccessible(page);
  await create.getByRole("button", { name: "Crear y elegir" }).click();
  await expect(create).toHaveCount(0);
  await expect(supplier(page)).toContainText("Distribuciones de Ejemplo, S.L.");
  await expect(supplier(page)).toContainText("Proveedor nuevo");
  await expect(left(page)).not.toContainText("Falta el proveedor.");

  await confirmSuggestion(page, 1, { quantity: "1", unit: "kg" });
  await expect(line(page, 1)).toContainText("Tomate pera");
  await expect(line(page, 1)).toContainText("por código");
  await confirmSuggestion(page, 2, { quantity: "1", unit: "garrafa" });
  await expect(line(page, 2)).toContainText("Aceite de oliva virgen extra");

  await expect(left(page).getByRole("listitem")).toHaveText([
    "Proveedor nuevo: sus primeros documentos se revisan siempre.",
  ]);
  await expectAccessible(page);
});

test("an existing supplier is chosen by typing; a product can't be chosen while corrections are unsaved", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const name = unique(testInfo, "Proveedor elegido");
  const created = await page.request.post("/api/suppliers", {
    data: { name, taxId: syntheticCif() },
  });
  expect(created.status()).toBe(201);
  await readDocument(page, unique(testInfo, "Albaran de otro proveedor"));

  await supplier(page)
    .getByRole("combobox", { name: "Elegir un proveedor" })
    .fill(name);
  await page.getByRole("option", { name, exact: true }).click();
  await expect(supplier(page)).toContainText(name);
  await expect(left(page)).not.toContainText("Falta el proveedor.");
  const confirm = line(page, 1).getByRole("button", {
    name: "Confirmar el producto",
  });
  await expect(confirm).toBeEnabled();

  // A correction not saved: the line to map may not be the one saved.
  await line(page, 1).getByRole("textbox", { name: "Cantidad" }).fill("6");
  await expect(confirm).toBeDisabled();
  await expect(line(page, 1)).toContainText(
    "Guarda las correcciones para elegir productos.",
  );
  await page.getByRole("button", { name: "Guardar correcciones" }).click();
  await expect(confirm).toBeEnabled();
});

test("a counter user sees no supplier or product to choose", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.counter);
  await readDocument(page, unique(testInfo, "Albaran en el mostrador"));
  await expect(
    page.getByRole("combobox", { name: "Elegir un proveedor" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Crear proveedor" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Confirmar el producto|Elegir producto/ }),
  ).toHaveCount(0);
  await expectAccessible(page);
});
