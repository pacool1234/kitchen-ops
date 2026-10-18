import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, signIn } from "./accounts.ts";
import {
  choose,
  createSupplier,
  openCatalogue,
  syntheticCif,
  unique,
} from "./catalogue.ts";

// Suppliers in the catalogue (#89): the office creates and edits them, with each field checked
// in Spanish, and counter staff read them. At desktop and phone sizes, with axe on every screen.

const title = (page: Page) => page.getByRole("heading", { level: 1 });
const toast = (page: Page, text: string) =>
  page.getByRole("region", { name: "Avisos" }).getByText(text);

// A seeded supplier (src/db/seed-catalogue.ts in the API).
const HUERTO = "Frutas y Verduras El Huerto, S.L.";
const HUERTO_TAX_ID = "B00100016";

test("office creates a supplier, its tax ID checked as it's typed", async ({
  page,
}, testInfo) => {
  await signIn(page, accounts.office);
  await openCatalogue(page, "Proveedores");
  await expect(page.getByRole("link", { name: HUERTO })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Nuevo proveedor" }).click();
  await expect(title(page)).toHaveText("Nuevo proveedor");

  // Left empty, the name says so once the field is left.
  const name = page.getByLabel("Nombre");
  await name.focus();
  await name.blur();
  await expect(page.getByText("Este campo es obligatorio.")).toBeVisible();
  await expect(name).toHaveAttribute("aria-invalid", "true");

  // A tax ID with the wrong control digit says so as soon as it's complete, before saving.
  const taxId = page.getByLabel("NIF/CIF");
  await taxId.fill("B00123456");
  await expect(
    page.getByText("No es un NIF, NIE o CIF válido", { exact: false }),
  ).toBeVisible();
  await expectAccessible(page);
  const cif = syntheticCif();
  await taxId.fill(cif.toLowerCase());
  await expect(page.getByText("CIF válido")).toBeVisible();

  const supplier = unique(testInfo, "Conservas del Puerto");
  await name.fill(supplier);
  await page.getByLabel("Correo electrónico").fill("pedidos@puerto.example");
  await page.getByRole("button", { name: "Crear proveedor" }).click();

  await expect(toast(page, "Proveedor creado")).toBeVisible();
  await expect(title(page)).toHaveText(supplier);
  await expect(page).toHaveURL(/\/catalogue\/suppliers\/[0-9a-f-]{36}$/);
  // Saved in the one form the API keeps it in.
  await expect(page.getByLabel("NIF/CIF")).toHaveValue(cif);
  await expectAccessible(page);
});

test("office edits a supplier; a tax ID another supplier has is refused on its field; then deactivates it", async ({
  page,
}, testInfo) => {
  await signIn(page, accounts.office);
  const name = unique(testInfo, "Aceites La Almazara");
  const { id } = await createSupplier(page, { name, taxId: syntheticCif() });
  await page.goto(`/catalogue/suppliers/${id}`);
  await expect(title(page)).toHaveText(name);

  await page.getByLabel("Teléfono").fill("+34 900 000 000");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(toast(page, "Cambios guardados")).toBeVisible();

  // Only the API knows who has a tax ID: the answer lands on the field.
  await page.getByLabel("NIF/CIF").fill(HUERTO_TAX_ID);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByText("Ya hay un proveedor con este NIF/CIF."),
  ).toBeVisible();
  await expect(page.getByLabel("NIF/CIF")).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  await page.reload();
  await page.getByRole("button", { name: "Desactivar" }).click();
  const dialog = page.getByRole("dialog", { name: `¿Desactivar ${name}?` });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Desactivar" }).click();
  await expect(toast(page, "Proveedor desactivado")).toBeVisible();
  await expect(page.getByText("Inactivo", { exact: true })).toBeVisible();

  // Gone from the list's active suppliers; there with the inactive ones.
  await page
    .getByRole("navigation", { name: "Estás en" })
    .getByRole("link", { name: "Proveedores" })
    .click();
  await page.getByLabel("Buscar").fill(name);
  await expect(page.getByText("Nada coincide con la búsqueda")).toBeVisible();
  await choose(page, "Estado", "Inactivos");
  await expect(page.getByRole("link", { name })).toBeVisible();

  await page.getByRole("link", { name }).click();
  await page.getByRole("button", { name: "Reactivar" }).click();
  await expect(toast(page, "Proveedor reactivado")).toBeVisible();
});

test("leaving a changed form asks first, and staying keeps what was typed", async ({
  page,
}, testInfo) => {
  await signIn(page, accounts.office);
  const name = unique(testInfo, "Quesos Valle");
  const { id } = await createSupplier(page, { name, taxId: syntheticCif() });
  await page.goto(`/catalogue/suppliers/${id}`);
  await expect(title(page)).toHaveText(name);

  // Nothing changed: leaving doesn't ask.
  const back = page
    .getByRole("navigation", { name: "Estás en" })
    .getByRole("link", { name: "Proveedores" });
  await back.click();
  await expect(title(page)).toHaveText("Proveedores");
  await page.goBack();
  await expect(title(page)).toHaveText(name);

  await page.getByLabel("Persona de contacto").fill("Ana Ruiz");
  await back.click();
  const dialog = page.getByRole("dialog", { name: "¿Salir sin guardar?" });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Seguir editando" }).click();
  await expect(title(page)).toHaveText(name);
  await expect(page.getByLabel("Persona de contacto")).toHaveValue("Ana Ruiz");

  await back.click();
  await dialog.getByRole("button", { name: "Salir sin guardar" }).click();
  await expect(title(page)).toHaveText("Proveedores");
});

test("search as you type asks the API once typing pauses, and the URL keeps the search", async ({
  page,
  isMobile,
}) => {
  await signIn(page, accounts.counter);
  await openCatalogue(page, "Proveedores");
  await expect(page.getByRole("link", { name: HUERTO })).toBeVisible();

  const searches: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/suppliers" && url.searchParams.has("q")) {
      searches.push(url.searchParams.get("q")!);
    }
  });
  await page.getByLabel("Buscar").pressSequentially("huerto", { delay: 40 });
  await expect(page.getByRole("link", { name: HUERTO })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Lácteos La Pradera, S.L." }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]q=huerto/);
  // One search for the six keys, not one per key.
  expect(searches).toEqual(["huerto"]);

  // A phone shows cards, a desktop a table: one at a time.
  await expect(page.getByRole("table", { name: "Proveedores" })).toBeVisible({
    visible: !isMobile,
  });
  await expect(page.getByRole("list", { name: "Proveedores" })).toBeVisible({
    visible: isMobile,
  });

  // Reloaded, or come back to, the list is as it was.
  await page.reload();
  await expect(page.getByLabel("Buscar")).toHaveValue("huerto");
  await expect(
    page.getByRole("link", { name: "Lácteos La Pradera, S.L." }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: HUERTO }).click();
  await expect(title(page)).toHaveText(HUERTO);
  await page.goBack();
  await expect(page.getByLabel("Buscar")).toHaveValue("huerto");
});

test("counter staff read the suppliers, and can't change them", async ({
  page,
}) => {
  await signIn(page, accounts.counter);
  await openCatalogue(page, "Proveedores");
  await expect(page.getByRole("link", { name: "Nuevo proveedor" })).toHaveCount(
    0,
  );

  await page.getByRole("link", { name: HUERTO }).click();
  await expect(title(page)).toHaveText(HUERTO);
  await expect(page.getByText(HUERTO_TAX_ID)).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Guardar cambios" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Desactivar" })).toHaveCount(0);
  await expectAccessible(page);

  // The address of the new supplier's form leads back to the list.
  await page.goto("/catalogue/suppliers/new");
  await expect(title(page)).toHaveText("Proveedores");
});
