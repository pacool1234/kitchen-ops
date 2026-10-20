import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, setUpTwoFactor, signIn } from "./accounts.ts";
import { arrivedAt, signedIn, syntheticCif, unique } from "./catalogue.ts";
import {
  MISREAD,
  openDocuments,
  photoPng,
  settled,
  statusOf,
  textPdf,
  uploadPdf,
} from "./documents.ts";

// Posting a reviewed delivery note into stock, and reversing it (#119, decision 0038): M7's
// flow, from a phone photo to stock with nothing typed but corrections. The fake model reads
// a delivery note from B00000018, which no supplier has: each test gives its supplier a tax
// ID of its own (see review-matching.spec.ts). The seeded products are shared by every test,
// so a test checks its own document's movements, never a product's whole stock.

test.setTimeout(120_000);

const left = (page: Page) =>
  page.getByRole("region", { name: "Antes de registrarlo" });
const supplier = (page: Page) =>
  page.getByRole("region", { name: "Proveedor" });
const line = (page: Page, n: number) =>
  page.getByRole("group", { name: `Línea ${n}`, exact: true });
const inStock = (page: Page) => page.getByRole("region", { name: "En stock" });
const postButton = (page: Page) =>
  page.getByRole("button", { name: "Registrar el albarán" });
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
  await expect(toast(page, "Producto confirmado").first()).toBeVisible();
  await expect(dialog).toHaveCount(0);
}

/** A seeded product's ID, by its exact name. */
async function productId(page: Page, name: string): Promise<string> {
  const response = await page.request.get(
    `/api/products?q=${encodeURIComponent(name)}`,
  );
  const { items } = (await response.json()) as {
    items: { id: string; name: string }[];
  };
  return items.find((p) => p.name === name)!.id;
}

/**
 * A delivery note read and reviewed through the API, as the signed-in office or owner user:
 * its supplier one of its own, and both lines remembered. Only "Proveedor nuevo" is left.
 */
async function reviewed(page: Page, label: string): Promise<string> {
  const { id } = await uploadPdf(page, textPdf(`${label}: un albaran normal`));
  await settled(page, id);
  const created = await page.request.post("/api/suppliers", {
    data: { name: `${label} S.L.`, taxId: syntheticCif() },
  });
  expect(created.status()).toBe(201);
  const { id: supplierId } = (await created.json()) as { id: string };
  expect(
    (
      await page.request.put(`/api/documents/${id}/supplier`, {
        data: { supplierId },
      })
    ).status(),
  ).toBe(200);
  const packs = [
    { product: "Tomate pera", pack: { quantity: "1", unit: "kg" } },
    {
      product: "Aceite de oliva virgen extra",
      pack: { quantity: "1", unit: "garrafa" },
    },
  ];
  for (const [i, { product, pack }] of packs.entries()) {
    const mapped = await page.request.post(
      `/api/documents/${id}/lines/${i + 1}/mapping`,
      { data: { productId: await productId(page, product), pack } },
    );
    expect(mapped.status(), await mapped.text()).toBe(201);
  }
  return id;
}

test("M7: a phone photo, misread, corrected, its supplier created, its products confirmed, posted into stock", async ({
  page,
  isMobile,
}, testInfo) => {
  await signedIn(page, accounts.office);
  await openDocuments(page);
  await page.getByRole("link", { name: "Subir documento" }).click();
  await arrivedAt(page, "Subir documento");
  // The fake model misreads it: line 1's 5 kg as 50.
  await page
    .getByLabel(isMobile ? "Hacer foto" : "Elegir archivos")
    .setInputFiles({
      name: "albaran.png",
      mimeType: "image/png",
      buffer: photoPng(`${unique(testInfo, "albaran")} ${MISREAD}`),
    });
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  await expect(statusOf(page)).toHaveText("Listo para revisar", {
    timeout: 30_000,
  });

  // Corrected where a check failed, and its supplier's tax ID made its own; then saved.
  await line(page, 1).getByRole("textbox", { name: "Cantidad" }).fill("5");
  await page.getByRole("textbox", { name: "NIF/CIF" }).fill(syntheticCif());
  await expect(postButton(page)).toBeDisabled();
  await page.getByRole("button", { name: "Guardar correcciones" }).click();
  await expect(toast(page, "Correcciones guardadas")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Comprobaciones" }),
  ).toContainText("Ha pasado todas las comprobaciones.");

  // Its supplier created from what was read, and each line's suggested product confirmed.
  await supplier(page).getByRole("button", { name: "Crear proveedor" }).click();
  const create = page.getByRole("dialog", { name: "Crear proveedor" });
  await create.getByRole("button", { name: "Crear y elegir" }).click();
  await expect(create).toHaveCount(0);
  await confirmSuggestion(page, 1, { quantity: "1", unit: "kg" });
  await confirmSuggestion(page, 2, { quantity: "1", unit: "garrafa" });
  await expect(left(page).getByRole("listitem")).toHaveText([
    "Proveedor nuevo: sus primeros documentos se revisan siempre.",
  ]);

  // Each line goes to its product's own storeroom unless another is chosen: the oil to the bar.
  const storeroom = (n: number) =>
    line(page, n).getByRole("combobox", { name: "Almacén" });
  await expect(storeroom(1)).toContainText("Cámara frigorífica (el suyo)");
  await expect(storeroom(2)).toContainText("Almacén seco (el suyo)");
  await storeroom(2).click();
  await page.getByRole("option", { name: "Barra", exact: true }).click();
  await expectAccessible(page);

  // Posted, after saying what it does.
  await postButton(page).click();
  const confirm = page.getByRole("dialog", {
    name: "¿Registrar el albarán ALB-0001?",
  });
  await expect(confirm).toContainText(
    "Entra en stock y ya no se puede cambiar: solo el propietario puede anularlo.",
  );
  await expectAccessible(page);
  await confirm.getByRole("button", { name: "Registrar" }).click();
  await expect(toast(page, "Albarán registrado")).toBeVisible();

  // Read-only now: its movements, each at its pack, into its storeroom, at its cost.
  await expect(statusOf(page)).toHaveText("Registrado");
  await expect(line(page, 1)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Guardar correcciones" }),
  ).toHaveCount(0);
  const posted = (n: number) =>
    inStock(page).getByRole("group", { name: `Línea ${n}`, exact: true });
  await expect(posted(1)).toContainText("Tomate pera");
  await expect(posted(1)).toContainText(
    "Entrada: 5 kg · Cámara frigorífica · 1,80 €/kg",
  );
  await expect(posted(2)).toContainText("Aceite de oliva virgen extra");
  await expect(posted(2)).toContainText("2 garrafa");
  await expect(posted(2)).toContainText("Entrada: 10 l · Barra · 4,90 €/l");
  // Only the owner reverses.
  await expect(page.getByRole("button", { name: "Anular" })).toHaveCount(0);
  await expectAccessible(page);
});

test("a counter user can't post a new supplier's delivery note: the office does", async ({
  page,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const id = await reviewed(
    page,
    unique(testInfo, "Albaran para el mostrador"),
  );
  await page.context().clearCookies();

  await signedIn(page, accounts.counter);
  await page.goto(`/documents/${id}`);
  await expect(left(page).getByRole("listitem")).toHaveText([
    "Proveedor nuevo: sus primeros documentos se revisan siempre.",
  ]);
  await expect(postButton(page)).toBeDisabled();
  await expect(left(page)).toContainText(
    "Proveedor nuevo: lo registra la oficina.",
  );
  await expectAccessible(page);
});

test("the owner reverses a posted delivery note, then makes a corrected copy to review again", async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, "the owner's 2FA setup runs once, at desktop size");
  await signIn(page, accounts.director);
  await setUpTwoFactor(page, accounts.director.password);
  const id = await reviewed(page, unique(testInfo, "Albaran que se anula"));
  const answer = await page.request.post(`/api/documents/${id}/post`, {
    data: { storerooms: [null, null] },
  });
  expect(answer.status(), await answer.text()).toBe(200);

  await page.goto(`/documents/${id}`);
  await expect(statusOf(page)).toHaveText("Registrado");
  await page.getByRole("button", { name: "Anular" }).click();
  const confirm = page.getByRole("dialog", {
    name: "¿Anular el albarán ALB-0001?",
  });
  await expect(confirm).toContainText(
    "Sus entradas salen del stock. No se puede deshacer.",
  );
  await expectAccessible(page);
  await confirm.getByRole("button", { name: "Anular" }).click();
  await expect(toast(page, "Documento anulado")).toBeVisible();

  await expect(statusOf(page)).toHaveText("Anulado");
  const reversal = page.getByRole("region", { name: "Anulación" });
  await expect(reversal).toContainText(
    `Anulado el ${today()} por Local director.`,
  );
  await expect(
    reversal.getByRole("group", { name: "Línea 1", exact: true }),
  ).toContainText(/Anulación: -5 kg · Cámara frigorífica · 1,80 €\/kg/);
  await expect(page.getByRole("button", { name: "Anular" })).toHaveCount(0);
  await expectAccessible(page);

  // The list says so too.
  await openDocuments(page);
  await expect(
    page.getByRole("row").filter({ hasText: "Anulado" }).first(),
  ).toBeVisible();
  await page.goto(`/documents/${id}`);

  // A corrected copy, in review, with the original's photo.
  await page
    .getByRole("button", { name: "Corregir y volver a registrar" })
    .click();
  await expect(page).not.toHaveURL(new RegExp(id));
  await expect(statusOf(page)).toHaveText("Listo para revisar");
  await expect(
    page.getByText("Copia corregida de un documento anulado."),
  ).toBeVisible();
  await expect(postButton(page)).toBeVisible();
  await page.getByRole("link", { name: "Ver el documento anulado" }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${id}$`));
  await expect(
    page.getByRole("link", { name: "Ver su copia corregida" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Corregir y volver a registrar" }),
  ).toHaveCount(0);
});
