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

  // A line added, not saved: the saved lines' products can't be put on the lines on screen.
  await page.getByRole("button", { name: "Añadir línea" }).click();
  await expect(line(page, 1)).not.toContainText("Sugerido");
  await expect(line(page, 3)).toContainText(
    "Guarda las correcciones para elegir productos.",
  );
});

test("a tax ID corrected to a supplier's finds it once saved; a number already received from the supplier chosen fails the duplicate check at once", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const name = unique(testInfo, "Proveedor por NIF");
  const taxId = syntheticCif();
  const created = await page.request.post("/api/suppliers", {
    data: { name, taxId },
  });
  expect(created.status()).toBe(201);

  // The first document: the tax ID corrected to the supplier's, and saved.
  await readDocument(page, unique(testInfo, "Primer albaran"));
  await page.getByRole("textbox", { name: "NIF/CIF" }).fill(taxId);
  await page.getByRole("button", { name: "Guardar correcciones" }).click();
  await expect(supplier(page)).toContainText(name);
  await expect(left(page)).not.toContainText("Falta el proveedor.");

  // The second, with the same number: chosen, the duplicate check fails before anything is saved.
  await readDocument(page, unique(testInfo, "Segundo albaran"));
  await expect(
    page.getByRole("region", { name: "Comprobaciones" }),
  ).toContainText("Ha pasado todas las comprobaciones.");
  await supplier(page)
    .getByRole("combobox", { name: "Elegir un proveedor" })
    .fill(name);
  await page.getByRole("option", { name, exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Comprobaciones" }).getByRole("button", {
      name: "Este número ya se recibió de este proveedor",
    }),
  ).toBeVisible();
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

// A load that fails (#140): what's left says so, with a way to try again, rather than nothing.
const loadFailed =
  "No se ha podido cargar lo que falta antes de registrarlo. Comprueba la conexión y vuelve a intentarlo.";

/** Answers 503 to the requests `matches` picks while `failing()` says so; the rest go through. */
async function failWhile(
  page: Page,
  matches: (url: URL) => boolean,
  failing: () => boolean,
) {
  await page.route(matches, (route) =>
    failing()
      ? route.fulfill({ status: 503, json: { error: "unavailable" } })
      : route.fallback(),
  );
}
const isMatching = (url: URL) => url.pathname.endsWith("/matching");

test("what's left can't be loaded: the page says so, offers nothing to post, and trying again loads it (#140)", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  let failing = true;
  await failWhile(page, isMatching, () => failing);
  await readDocument(page, unique(testInfo, "Albaran sin cargar"));

  await expect(left(page)).toContainText(loadFailed);
  await expect(
    left(page).getByRole("button", { name: "Registrar el albarán" }),
  ).toHaveCount(0);
  await expect(supplier(page)).toHaveCount(0);
  await expectAccessible(page);

  failing = false;
  await left(page).getByRole("button", { name: "Reintentar" }).click();
  await expect(left(page)).toContainText("Falta el proveedor.");
  await expect(left(page)).not.toContainText(loadFailed);
  await expect(supplier(page)).toBeVisible();
});

test("what's left can't be loaded again after saving: what was shown goes, and trying again brings it back (#140)", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  let failing = false;
  await failWhile(page, isMatching, () => failing);
  await readDocument(page, unique(testInfo, "Albaran que no recarga"));
  await expect(left(page)).toContainText("Falta el proveedor.");

  failing = true;
  await line(page, 1).getByRole("textbox", { name: "Cantidad" }).fill("6");
  await page.getByRole("button", { name: "Guardar correcciones" }).click();
  await expect(toast(page, "Correcciones guardadas")).toBeVisible();
  await expect(left(page)).toContainText(loadFailed);
  await expect(left(page)).not.toContainText("Falta el proveedor.");
  await expect(supplier(page)).toHaveCount(0);

  failing = false;
  await left(page).getByRole("button", { name: "Reintentar" }).click();
  await expect(left(page)).toContainText("Falta el proveedor.");
  await expect(supplier(page)).toBeVisible();
});

test("the storerooms can't be loaded: the page says so too, and trying again loads them (#140)", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  let failing = true;
  await failWhile(
    page,
    (url) => url.pathname === "/api/storerooms",
    () => failing,
  );
  await readDocument(page, unique(testInfo, "Albaran sin almacenes"));

  await expect(left(page)).toContainText(loadFailed);
  failing = false;
  await left(page).getByRole("button", { name: "Reintentar" }).click();
  await expect(left(page)).toContainText("Falta el proveedor.");
  await expect(left(page)).not.toContainText(loadFailed);
});
