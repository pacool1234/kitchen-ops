import { expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts } from "./accounts.ts";
import { arrivedAt, signedIn, unique } from "./catalogue.ts";
import { openStock, received, rowOf } from "./stock.ts";

// Stock per storeroom (#150): every product in every storeroom it has moved through, valued for
// office and the owner, and the movements behind it, each linking to its document. Counter users
// see quantities, never euros. Each test receives products of its own, so the other tests'
// stock never shows in its rows.

test.setTimeout(120_000);

test("office finds a delivery note's goods in the stock list, valued, and follows a product's movement back to the delivery note", async ({
  page,
  isMobile,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const label = unique(testInfo, "Stock");
  const { note, tomato, oil } = await received(page, label);

  await openStock(page);
  await page.getByRole("searchbox", { name: "Buscar" }).fill(label);
  await expect(rowOf(page, isMobile, tomato)).toHaveCount(1);
  for (const text of ["Cámara frigorífica", "5 kg", "1,80 €/kg", "9,00 €"]) {
    await expect(rowOf(page, isMobile, tomato)).toContainText(text);
  }
  for (const text of ["Almacén seco", "10 l", "4,90 €/l", "49,00 €"]) {
    await expect(rowOf(page, isMobile, oil)).toContainText(text);
  }
  // What the whole stock is worth, whatever was searched: more than these two.
  await expect(
    page.getByRole("region", { name: "Valor del stock" }),
  ).toContainText("Total");
  await expectAccessible(page);

  await rowOf(page, isMobile, tomato)
    .getByRole("link", { name: tomato })
    .click();
  await arrivedAt(page, tomato);
  await expect(
    page.getByRole("region", { name: "En cada almacén", exact: true }),
  ).toContainText("9,00 €");
  const movements = page.getByRole("region", {
    name: "Movimientos",
    exact: true,
  });
  const receipt = rowOf(page, isMobile, "Entrada");
  for (const text of ["+5 kg", "Cámara frigorífica", "1,80 €/kg"]) {
    await expect(receipt).toContainText(text);
  }
  await expect(movements).toBeVisible();
  await expectAccessible(page);

  await receipt.getByRole("link", { name: "Albarán ALB-0001" }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${note}$`));
  await arrivedAt(page, "Albarán ALB-0001");
});

test("a counter user sees the stock and its movements without a euro", async ({
  page,
  isMobile,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const label = unique(testInfo, "Stock del mostrador");
  const { tomato } = await received(page, label);
  await page.context().clearCookies();

  await signedIn(page, accounts.counter);
  await openStock(page);
  await page.getByRole("searchbox", { name: "Buscar" }).fill(label);
  await expect(rowOf(page, isMobile, tomato)).toContainText("5 kg");
  await expect(page.getByRole("main")).not.toContainText("€");
  // Nor empty places for them: no column for a cost or a value.
  await expect(
    page.getByRole("columnheader", { name: /^(Coste|Coste medio|Valor)$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Valor del stock" }),
  ).toHaveCount(0);
  await expectAccessible(page);

  await rowOf(page, isMobile, tomato)
    .getByRole("link", { name: tomato })
    .click();
  await arrivedAt(page, tomato);
  await expect(rowOf(page, isMobile, "Entrada")).toContainText("+5 kg");
  await expect(page.getByRole("main")).not.toContainText("€");
  // Nor empty places for them: no column for a cost or a value.
  await expect(
    page.getByRole("columnheader", { name: /^(Coste|Coste medio|Valor)$/ }),
  ).toHaveCount(0);
  await expectAccessible(page);
});

/** The longest from opening Stock to a full page of rows showing (decision 0045). */
const SCREEN_BUDGET_MS = 1500;

test(`a full page of the stock list shows within ${SCREEN_BUDGET_MS} ms of opening it`, async ({
  page,
  isMobile,
}) => {
  // The answer for 400 products' first page, so the budget measures drawing it; the API's own
  // budget measures working it out (apps/api/src/stock/budget.test.ts).
  const items = Array.from({ length: 50 }, (_, i) => ({
    product: {
      id: `0199a000-0000-7000-8000-${String(i).padStart(12, "0")}`,
      name: `Producto ${String(i + 1).padStart(3, "0")}`,
      baseUnit: "g",
      category: "produce",
    },
    storeroom: { id: "0199a000-0000-7000-8000-100000000000", name: "Cámara" },
    onHand: 12_500,
    averageCost: "0.002000",
    value: "25.00",
  }));
  await page.route(
    (url) => url.pathname === "/api/stock",
    (route) =>
      route.fulfill({
        json: {
          items,
          total: 400,
          page: 1,
          pageSize: 50,
          totals: {
            storerooms: [{ storeroom: items[0]!.storeroom, value: "10000.00" }],
            value: "10000.00",
          },
        },
      }),
  );
  await signedIn(page, accounts.office);

  const start = Date.now();
  await openStock(page);
  await expect(rowOf(page, isMobile, "Producto 050")).toBeVisible();
  expect(Date.now() - start).toBeLessThan(SCREEN_BUDGET_MS);
  // "Producto 0…": not the table's "Producto" heading.
  await expect(rowOf(page, isMobile, "Producto 0")).toHaveCount(50);
});
