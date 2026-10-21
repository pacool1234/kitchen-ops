import { expect, type APIResponse, type Page } from "@playwright/test";
import { arrivedAt, syntheticCif } from "./catalogue.ts";
import { settled, textPdf, uploadPdf } from "./documents.ts";
import { mainNav } from "./shell.ts";

// Stock in the browser tests (#150, #151): goods received through the API, so a test has stock
// of its own to look at, and the stock list's rows.

/** Waits for an API call, and checks it succeeded, saying why not if it didn't. */
export async function ok(answer: Promise<APIResponse>) {
  const response = await answer;
  expect(response.status(), await response.text()).toBeLessThan(300);
  return response;
}

/** A seeded storeroom's ID, by its exact name. */
export async function storeroomId(page: Page, name: string): Promise<string> {
  const response = await page.request.get(
    `/api/storerooms?q=${encodeURIComponent(name)}`,
  );
  const { items } = (await response.json()) as {
    items: { id: string; name: string }[];
  };
  return items.find((s) => s.name === name)!.id;
}

/**
 * Through the API, as the signed-in office user: a supplier, a tomato and an oil of the test's
 * own, and the fake model's delivery note from that supplier posted with them. Its 5 kg of
 * tomatoes at 1,80 €/kg go into the cold room (9,00 €), its 2 garrafas of 5 l of oil at 24,50 €
 * into the dry store (10 l at 4,90 €/l, 49,00 €).
 */
export async function received(page: Page, label: string) {
  const supplier = await ok(
    page.request.post("/api/suppliers", {
      data: { name: `${label} S.L.`, taxId: syntheticCif() },
    }),
  );
  const { id: supplierId } = (await supplier.json()) as { id: string };
  const product = async (body: object) =>
    (
      (await (
        await ok(page.request.post("/api/products", { data: body }))
      ).json()) as { id: string }
    ).id;
  const tomato = `Tomate ${label}`;
  const oil = `Aceite ${label}`;
  const tomatoId = await product({
    name: tomato,
    baseUnit: "g",
    category: "produce",
    conversions: [{ unit: "kg", factor: 1000 }],
  });
  const oilId = await product({
    name: oil,
    baseUnit: "ml",
    category: "dry_goods",
    conversions: [{ unit: "garrafa", factor: 5000 }],
  });

  const { id: note } = await uploadPdf(page, textPdf(`${label}: el albaran`));
  await settled(page, note);
  await ok(
    page.request.put(`/api/documents/${note}/supplier`, {
      data: { supplierId },
    }),
  );
  const packs = [
    { productId: tomatoId, pack: { quantity: "1", unit: "kg" } },
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
      data: {
        storerooms: [
          await storeroomId(page, "Cámara frigorífica"),
          await storeroomId(page, "Almacén seco"),
        ],
      },
    }),
  );
  return { note, tomato, tomatoId, oil };
}

/** A row of a table, or a card on a phone, that names `text`. */
export const rowOf = (page: Page, isMobile: boolean, text: string) =>
  page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: text });

export async function openStock(page: Page) {
  await mainNav(page).getByRole("link", { name: "Stock" }).click();
  await arrivedAt(page, "Stock");
}

/** Today in Madrid, as a page dates it: "22/10/2026". */
export const today = () =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
