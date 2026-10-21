import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts } from "./accounts.ts";
import { loadedAt, signedIn, syntheticCif, unique } from "./catalogue.ts";
import { INVOICE, settled, statusOf, textPdf, uploadPdf } from "./documents.ts";

// An invoice correcting its delivery note's price (#120, decision 0041): M7's last "done
// when". The fake model reads a delivery note, ALB-0001, and with INVOICE in its text the
// invoice for it, FAC-0001, the oil at 26,00 € a garrafa instead of 24,50 €. Each test has its
// own supplier, and its own oil, so the oil's stock and average cost are the test's alone.

test.setTimeout(120_000);

const left = (page: Page) =>
  page.getByRole("region", { name: "Antes de registrarlo" });
const line = (page: Page, n: number) =>
  page.getByRole("group", { name: `Línea ${n}`, exact: true });
const differences = (page: Page) =>
  page.getByRole("region", { name: "Diferencias de precio" });
const inStock = (page: Page) => page.getByRole("region", { name: "En stock" });
const stock = (page: Page) =>
  page.getByRole("region", { name: "Stock", exact: true });
const postButton = (page: Page) =>
  page.getByRole("button", { name: "Registrar la factura" });
// Reka names the notices' region with its key too: "Avisos (F8)".
const toast = (page: Page, text: string) =>
  page
    .getByRole("region", { name: /^Avisos/ })
    .getByText(text, { exact: true });

/** Today in the restaurant, as the screens write a date: 21/10/2026. */
const today = () =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());

/** A seeded product's or storeroom's ID, by its exact name. */
async function idOf(
  page: Page,
  list: "products" | "storerooms",
  name: string,
): Promise<string> {
  const response = await page.request.get(
    `/api/${list}?q=${encodeURIComponent(name)}`,
  );
  const { items } = (await response.json()) as {
    items: { id: string; name: string }[];
  };
  return items.find((p) => p.name === name)!.id;
}

/** Waits for an API call, and checks it succeeded, saying why not if it didn't. */
async function ok(answer: Promise<APIResponse>) {
  const response = await answer;
  expect(response.status(), await response.text()).toBeLessThan(300);
  return response;
}

/**
 * Through the API, as the signed-in office user: a supplier and an oil of the test's own; the
 * fake model's delivery note from it posted, its oil into the dry store at 24,50 € a garrafa
 * of 5 l; then its invoice read, with its supplier chosen. Its lines' delivery-note lines are
 * only suggested.
 */
async function deliveredAndInvoiced(page: Page, label: string) {
  const supplier = await ok(
    page.request.post("/api/suppliers", {
      data: { name: `${label} S.L.`, taxId: syntheticCif() },
    }),
  );
  const { id: supplierId } = (await supplier.json()) as { id: string };
  const oilName = `Aceite ${label}`;
  const oil = await ok(
    page.request.post("/api/products", {
      data: {
        name: oilName,
        baseUnit: "ml",
        category: "dry_goods",
        defaultStoreroomId: await idOf(page, "storerooms", "Almacén seco"),
        conversions: [{ unit: "garrafa", factor: 5000 }],
      },
    }),
  );
  const { id: oilId } = (await oil.json()) as { id: string };

  const { id: note } = await uploadPdf(page, textPdf(`${label}: el albaran`));
  await settled(page, note);
  await ok(
    page.request.put(`/api/documents/${note}/supplier`, {
      data: { supplierId },
    }),
  );
  const packs = [
    {
      productId: await idOf(page, "products", "Tomate pera"),
      pack: { quantity: "1", unit: "kg" },
    },
    { productId: oilId, pack: { quantity: "1", unit: "garrafa" } },
  ];
  for (const [i, mapping] of packs.entries()) {
    await ok(
      page.request.post(`/api/documents/${note}/lines/${i + 1}/mapping`, {
        data: mapping,
      }),
    );
  }
  await ok(
    page.request.post(`/api/documents/${note}/post`, {
      data: { storerooms: [null, null] },
    }),
  );

  const { id: invoice } = await uploadPdf(
    page,
    textPdf(`${label}: la factura ${INVOICE}`),
  );
  await settled(page, invoice);
  await ok(
    page.request.put(`/api/documents/${invoice}/supplier`, {
      data: { supplierId },
    }),
  );
  return { note, invoice, oilId, oilName };
}

test("M7: an invoice corrects its delivery note's price: each line's delivery-note line confirmed or chosen, the difference shown, posted, and the product's average cost following", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const { note, invoice, oilId, oilName } = await deliveredAndInvoiced(
    page,
    unique(testInfo, "Factura"),
  );

  // The oil as the delivery note put it in: 2 garrafas of 5 l at 24,50 €.
  await page.goto(`/catalogue/products/${oilId}`);
  await loadedAt(page, oilName);
  await expect(stock(page)).toContainText("Almacén seco");
  await expect(stock(page)).toContainText("10 l");
  await expect(stock(page)).toContainText("4,90 €/l");

  // In review: each line's delivery-note line suggested, by the number the invoice lists.
  await page.goto(`/documents/${invoice}`);
  await expect(statusOf(page)).toHaveText("Listo para revisar");
  await expect(left(page).getByRole("listitem")).toHaveText([
    "Hay líneas sin albarán confirmado que no se reciben con la factura.",
    "Proveedor nuevo: sus primeros documentos se revisan siempre.",
  ]);
  await expect(line(page, 2)).toContainText(
    `Sugerido: albarán ALB-0001 del ${today()}, línea 2 · 2 garrafa`,
  );
  await expect(postButton(page)).toBeDisabled();

  // The differences: the tomatoes at the same price, the oil 0,30 € a litre dearer.
  const oilRow = differences(page)
    .getByRole("row")
    .filter({ hasText: "Aceite" });
  await expect(oilRow).toContainText("4,90 €/l");
  await expect(oilRow).toContainText("5,20 €/l");
  await expect(oilRow).toContainText("3,00 €");
  await expect(
    differences(page).getByRole("row").filter({ hasText: "Tomate pera" }),
  ).toContainText("0,00 €");
  await expect(
    differences(page).getByRole("row").filter({ hasText: "Total" }),
  ).toContainText("3,00 €");
  await expectAccessible(page);

  // Each suggestion confirmed.
  for (const n of [1, 2]) {
    await line(page, n)
      .getByRole("button", { name: "Confirmar el albarán" })
      .click();
    await expect(line(page, n)).toContainText(
      `Factura el albarán ALB-0001 del ${today()}, línea ${n}`,
    );
  }
  await expect(left(page).getByRole("listitem")).toHaveText([
    "Proveedor nuevo: sus primeros documentos se revisan siempre.",
  ]);

  // Line 1 received with the invoice instead: then it needs its storeroom, like a delivery
  // note's line. Then its delivery-note line chosen again, from the dialog.
  await line(page, 1)
    .getByRole("button", { name: "Sin albarán: entra en stock con la factura" })
    .click();
  await expect(line(page, 1)).toContainText("Entra en stock con la factura.");
  await expect(
    line(page, 1).getByRole("combobox", { name: "Almacén" }),
  ).toBeVisible();
  await line(page, 1)
    .getByRole("button", { name: "Elegir un albarán" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Albarán de la línea 1" });
  await expect(dialog).toContainText(`Albarán ALB-0001 · ${today()}`);
  await expectAccessible(page);
  await dialog.getByRole("button", { name: /^Línea 1: Tomate pera/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(line(page, 1)).toContainText(
    `Factura el albarán ALB-0001 del ${today()}, línea 1`,
  );
  await expect(
    line(page, 1).getByRole("combobox", { name: "Almacén" }),
  ).toHaveCount(0);
  await expect(left(page).getByRole("listitem")).toHaveText([
    "Proveedor nuevo: sus primeros documentos se revisan siempre.",
  ]);

  // Posted, after saying what it does.
  await postButton(page).click();
  const confirm = page.getByRole("dialog", {
    name: "¿Registrar la factura FAC-0001?",
  });
  await expect(confirm).toContainText(
    "Corrige el coste de lo que trajeron sus albaranes y ya no se puede cambiar: solo el propietario puede anularla.",
  );
  await confirm.getByRole("button", { name: "Registrar" }).click();
  await expect(toast(page, "Factura registrada")).toBeVisible();

  // What it did: the oil's receipt corrected to the invoice's price, the tomatoes untouched.
  await expect(statusOf(page)).toHaveText("Registrado");
  const posted = (n: number) =>
    inStock(page).getByRole("group", { name: `Línea ${n}`, exact: true });
  await expect(posted(1)).toContainText(
    "Factura la línea 1 del albarán ALB-0001",
  );
  await expect(posted(1)).toContainText("Mismo precio: nada que corregir.");
  await expect(posted(2)).toContainText(
    "Factura la línea 2 del albarán ALB-0001",
  );
  await expect(posted(2)).toContainText(
    "Corrección de precio: 10 l · Almacén seco · 5,20 €/l",
  );
  await expect(posted(2)).toContainText(
    "Anulación: -10 l · Almacén seco · 4,90 €/l",
  );
  await expectAccessible(page);

  // The delivery note says which invoice bills it.
  await posted(2).getByRole("link", { name: "Albarán ALB-0001" }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${note}$`));
  await expect(
    inStock(page).getByRole("group", { name: "Línea 2", exact: true }),
  ).toContainText("Facturada en");
  await inStock(page)
    .getByRole("group", { name: "Línea 2", exact: true })
    .getByRole("link", { name: "Factura FAC-0001" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/documents/${invoice}$`));

  // And the oil's average cost follows the invoice; its stock stays.
  await page.goto(`/catalogue/products/${oilId}`);
  await loadedAt(page, oilName);
  await expect(stock(page)).toContainText("10 l");
  await expect(stock(page)).toContainText("5,20 €/l");
  await expectAccessible(page);
});

test("a counter user sees an invoice in review read-only, with nothing to choose or post: office and the owner review and post it (decision 0037)", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const { invoice } = await deliveredAndInvoiced(
    page,
    unique(testInfo, "Factura para el mostrador"),
  );
  await page.context().clearCookies();

  await signedIn(page, accounts.counter);
  await page.goto(`/documents/${invoice}`);
  await expect(statusOf(page)).toHaveText("Listo para revisar");
  await expect(
    page.getByRole("heading", { name: "Lo leído", exact: true }),
  ).toBeVisible();
  await expect(left(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /albarán/ })).toHaveCount(0);
  await expect(postButton(page)).toHaveCount(0);
  await expectAccessible(page);
});
