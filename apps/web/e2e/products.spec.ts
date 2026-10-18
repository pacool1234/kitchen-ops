import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts } from "./accounts.ts";
import {
  arrivedAt,
  choose,
  createProduct,
  createSupplier,
  createSupplierProduct,
  openCatalogue,
  signedIn,
  syntheticCif,
  unique,
} from "./catalogue.ts";

// Products in the catalogue (#89): the list, filtered by category and storeroom; the office
// creates and edits them with their purchase units; counter staff read them. At desktop and
// phone sizes, with axe on every screen.

const title = (page: Page) => page.getByRole("heading", { level: 1 });
// Reka names the notices' region with its key too: "Avisos (F8)".
const toast = (page: Page, text: string) =>
  page
    .getByRole("region", { name: /^Avisos/ })
    .getByText(text, { exact: true });
/** A purchase unit's row in the product's form: "Unidad de compra 2". */
const unitRow = (page: Page, n: number) =>
  page.getByRole("group", { name: `Unidad de compra ${n}` });

test("the product list: a page at a time in Spanish order, filtered by category and by storeroom", async ({
  page,
  isMobile,
}) => {
  await signedIn(page, accounts.counter);
  await openCatalogue(page, "Productos");

  // The seed has 43 active products: pages of 20, 20 and 3.
  const pages = page.getByRole("navigation", { name: "Páginas" });
  await expect(pages.getByText("1–20 de 43")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Aceite de oliva virgen extra" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Azafrán en hebra (descatalogado)" }),
  ).toHaveCount(0);
  // A phone shows cards, a desktop a table.
  await expect(page.getByRole("table", { name: "Productos" })).toBeVisible({
    visible: !isMobile,
  });
  await expect(page.getByRole("list", { name: "Productos" })).toBeVisible({
    visible: isMobile,
  });
  await expectAccessible(page);

  await choose(page, "Categoría", "Bebidas");
  await expect(
    page.getByRole("link", { name: "Cerveza de barril" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Tomate pera" })).toHaveCount(0);
  await expect(page).toHaveURL(/category=drinks/);

  // Drinks kept in the dry store: none in the seed.
  await choose(page, "Almacén habitual", "Almacén seco");
  await expect(page.getByText("Nada coincide con la búsqueda")).toBeVisible();
  await choose(page, "Almacén habitual", "Barra");
  await expect(page.getByRole("link", { name: "Café en grano" })).toBeVisible();
});

test("office creates a product with its purchase units, then edits and deactivates it", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  await openCatalogue(page, "Productos");
  await page.getByRole("link", { name: "Nuevo producto" }).click();
  await arrivedAt(page, "Nuevo producto");

  const name = unique(testInfo, "Calabacín");
  await page.getByLabel("Nombre").fill(name);
  await choose(page, "Unidad base", "gramos");
  await choose(page, "Categoría", "Fruta y verdura");
  await choose(page, "Almacén habitual", "Cámara frigorífica");

  // A unit named after the base unit is refused on its own row.
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  await unitRow(page, 1).getByLabel("Unidad").fill("g");
  await unitRow(page, 1).getByLabel("Contiene").fill("1");
  await page.getByRole("button", { name: "Crear producto" }).click();
  await expect(
    unitRow(page, 1).getByText("Ese nombre está reservado."),
  ).toBeVisible();

  // A box of 6 kg, typed in kilos, with its live example.
  await unitRow(page, 1).getByLabel("Unidad").fill("caja");
  await unitRow(page, 1).getByLabel("Contiene").fill("6");
  await expect(unitRow(page, 1).getByText("1 caja = 6 kg")).toBeVisible();
  await page.getByRole("button", { name: "Añadir unidad" }).click();
  await unitRow(page, 2).getByLabel("Unidad").fill("bandeja");
  await unitRow(page, 2).getByLabel("Contiene").fill("0,5");
  await expect(unitRow(page, 2).getByText("1 bandeja = 500 g")).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("button", { name: "Crear producto" }).click();
  await expect(toast(page, "Producto creado")).toBeVisible();
  await arrivedAt(page, name);
  // Saved smallest first, the base unit no longer to choose.
  await expect(unitRow(page, 1).getByLabel("Unidad")).toHaveValue("bandeja");
  await expect(unitRow(page, 2).getByLabel("Unidad")).toHaveValue("caja");
  await expect(
    page.getByText("No se puede cambiar", { exact: false }),
  ).toBeVisible();
  await expectAccessible(page);

  await unitRow(page, 1)
    .getByRole("button", { name: "Quitar bandeja" })
    .click();
  await choose(page, "Categoría", "Congelados");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(toast(page, "Cambios guardados")).toBeVisible();
  await page.reload();
  await expect(unitRow(page, 1).getByLabel("Unidad")).toHaveValue("caja");
  await expect(unitRow(page, 2)).toHaveCount(0);

  await page.getByRole("button", { name: "Desactivar" }).click();
  await page
    .getByRole("dialog", { name: `¿Desactivar ${name}?` })
    .getByRole("button", { name: "Desactivar" })
    .click();
  await expect(toast(page, "Producto desactivado")).toBeVisible();
  await expect(page.getByText("Inactivo", { exact: true })).toBeVisible();
});

test("a purchase unit a supplier's pack uses can't be removed", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const name = unique(testInfo, "Berenjena");
  const product = await createProduct(page, {
    name,
    baseUnit: "g",
    category: "produce",
    conversions: [{ unit: "caja", factor: 5000 }],
  });
  const supplier = await createSupplier(page, {
    name: unique(testInfo, "Huerta Sur"),
    taxId: syntheticCif(),
  });
  await createSupplierProduct(page, {
    supplierId: supplier.id,
    code: "BER-5",
    description: "Berenjena, caja de 5 kg",
    productId: product.id,
    pack: { quantity: "1", unit: "caja" },
  });

  await page.goto(`/catalogue/products/${product.id}`);
  await arrivedAt(page, name);
  // Its supplier products are listed on its page.
  await expect(page.getByText("Berenjena, caja de 5 kg")).toBeVisible();

  await unitRow(page, 1).getByRole("button", { name: "Quitar caja" }).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByText("Esta unidad la usa un producto de proveedor", {
      exact: false,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(unitRow(page, 1).getByLabel("Unidad")).toHaveValue("caja");
});

test("counter staff read a product, its purchase units and who sells it, and can't change it", async ({
  page,
}) => {
  await signedIn(page, accounts.counter);
  await openCatalogue(page, "Productos");
  await expect(page.getByRole("link", { name: "Nuevo producto" })).toHaveCount(
    0,
  );

  await page.getByLabel("Buscar").fill("tomate pera");
  await page.getByRole("link", { name: "Tomate pera" }).click();
  await arrivedAt(page, "Tomate pera");
  await expect(page.getByText("1 caja = 6 kg")).toBeVisible();
  // Sold by two seeded suppliers.
  await expect(
    page
      .getByRole("link", { name: "Frutas y Verduras El Huerto, S.L." })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Ultramarinos y Distribución Sol, S.L." }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Guardar cambios" }),
  ).toHaveCount(0);
  await expectAccessible(page);
});

test("signed out, the product list sends you to sign in", async ({ page }) => {
  await page.goto("/catalogue/products");
  await expect(title(page)).toHaveText("Iniciar sesión");
});
