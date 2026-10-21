import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, setUpTwoFactor, signIn } from "./accounts.ts";
import { arrivedAt, choose, signedIn, unique } from "./catalogue.ts";
import { ok, openStock, received, rowOf, storeroomId, today } from "./stock.ts";

// Waste and transfers, recorded on a phone or a desktop (#151): a storeroom, products found by
// typing and their quantities, posted after a confirmation; then the page of what was posted,
// read-only, which the owner reverses. Each test receives products of its own, so the other
// tests' stock never shows in its rows.

test.setTimeout(120_000);

/** Line `n` of the form, from 1. */
const lineOf = (page: Page, n: number) =>
  page.getByRole("group", { name: `Producto ${n}` });

/** Finds a product by typing part of its name, in line `n`. */
async function chooseProduct(
  page: Page,
  n: number,
  typed: string,
  name: string,
) {
  await lineOf(page, n).getByRole("combobox", { name: "Producto" }).fill(typed);
  await page.getByRole("option", { name, exact: true }).click();
}

const movementsOf = (page: Page) =>
  page.getByRole("region", { name: "Movimientos", exact: true });

test("a counter user records spoiled tomatoes: more than there is is refused on its line; 1,5 kg is posted, and the stock goes down", async ({
  page,
  isMobile,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const label = unique(testInfo, "Merma");
  const { tomato } = await received(page, label);
  await page.context().clearCookies();

  await signedIn(page, accounts.counter);
  await openStock(page);
  await page.getByRole("link", { name: "Registrar merma" }).click();
  await arrivedAt(page, "Registrar merma");
  await choose(page, "Almacén", "Cámara frigorífica");
  await chooseProduct(page, 1, label, tomato);
  // Kilos, once: the tomato's own "kg" is the same kilo.
  await lineOf(page, 1).getByRole("combobox", { name: "Unidad" }).click();
  await expect(page.getByRole("option")).toHaveText(["kg"]);
  await page.keyboard.press("Escape");
  await lineOf(page, 1).getByLabel("Cantidad").fill("10");
  await choose(page, "Motivo", "Estropeado");
  await page.getByLabel("Nota").fill("Se rompió la cámara");
  await expectAccessible(page);

  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  let confirm = page.getByRole("dialog", { name: "¿Registrar esta merma?" });
  await expect(confirm).toContainText(`10 kg · ${tomato}`);
  await expect(confirm).toContainText("Cámara frigorífica");
  await confirm.getByRole("button", { name: "Registrar" }).click();
  // Only 5 kg came in: refused on the line's quantity, and nothing posted.
  await expect(lineOf(page, 1)).toContainText("No hay tanto en stock.");
  await expect(page).toHaveURL(/\/stock\/waste\/new$/);

  await lineOf(page, 1).getByLabel("Cantidad").fill("1,5");
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  confirm = page.getByRole("dialog", { name: "¿Registrar esta merma?" });
  await expect(confirm).toContainText(`1,5 kg · ${tomato}`);
  await confirm.getByRole("button", { name: "Registrar" }).click();

  await arrivedAt(page, `Merma del ${today()}`);
  for (const text of [
    "Cámara frigorífica",
    "Estropeado",
    "Se rompió la cámara",
    "Local counter",
  ]) {
    await expect(page.getByRole("main")).toContainText(text);
  }
  await expect(movementsOf(page)).toContainText(tomato);
  await expect(movementsOf(page)).toContainText(
    "Merma · -1,5 kg · Cámara frigorífica",
  );
  await expect(page.getByRole("main")).not.toContainText("€");
  await expect(page.getByRole("button", { name: "Anular" })).toHaveCount(0);
  await expectAccessible(page);

  await openStock(page);
  await page.getByRole("searchbox", { name: "Buscar" }).fill(label);
  await expect(rowOf(page, isMobile, tomato)).toContainText("3,5 kg");
});

test("office moves 2 kg of tomatoes from the cold room to the dry store: both movements at the same cost, and the tomatoes are worth the same", async ({
  page,
  isMobile,
}, testInfo) => {
  await signedIn(page, accounts.office);
  const label = unique(testInfo, "Traspaso");
  const { tomato } = await received(page, label);

  await openStock(page);
  await page.getByRole("searchbox", { name: "Buscar" }).fill(label);
  await expect(rowOf(page, isMobile, tomato)).toContainText("9,00 €");
  await page.getByRole("link", { name: "Registrar traspaso" }).click();
  await arrivedAt(page, "Registrar traspaso");
  await choose(page, "Origen", "Cámara frigorífica");
  await choose(page, "Destino", "Almacén seco");
  await chooseProduct(page, 1, label, tomato);
  await lineOf(page, 1).getByLabel("Cantidad").fill("2");
  await expectAccessible(page);

  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  const confirm = page.getByRole("dialog", {
    name: "¿Registrar este traspaso?",
  });
  await expect(confirm).toContainText(`2 kg · ${tomato}`);
  await confirm.getByRole("button", { name: "Registrar" }).click();

  await arrivedAt(page, `Traspaso del ${today()}`);
  await expect(movementsOf(page)).toContainText(
    "Traspaso (salida) · -2 kg · Cámara frigorífica · 1,80 €/kg",
  );
  await expect(movementsOf(page)).toContainText(
    "Traspaso (entrada) · +2 kg · Almacén seco · 1,80 €/kg",
  );
  // Reversing is the owner's.
  await expect(page.getByRole("button", { name: "Anular" })).toHaveCount(0);
  await expectAccessible(page);

  // 3 kg left at 5,40 € and 2 kg arrived at 3,60 €: the 9,00 € the 5 kg were worth.
  await openStock(page);
  await page.getByRole("searchbox", { name: "Buscar" }).fill(label);
  const tomatoes = rowOf(page, isMobile, tomato);
  await expect(tomatoes).toHaveCount(2);
  const cold = tomatoes.filter({ hasText: "Cámara frigorífica" });
  const dry = tomatoes.filter({ hasText: "Almacén seco" });
  for (const text of ["3 kg", "5,40 €"]) await expect(cold).toContainText(text);
  for (const text of ["2 kg", "3,60 €"]) await expect(dry).toContainText(text);
});

test("the owner follows a product's waste to its page and reverses it: the tomatoes are back", async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, "the owner's 2FA setup runs once, at desktop size");
  await signIn(page, accounts.keeper);
  await setUpTwoFactor(page, accounts.keeper.password);
  const label = unique(testInfo, "Merma anulada");
  const { tomato, tomatoId } = await received(page, label);
  await ok(
    page.request.put(`/api/waste/${randomUUID()}`, {
      data: {
        storeroomId: await storeroomId(page, "Cámara frigorífica"),
        reason: "expired",
        lines: [{ productId: tomatoId, quantity: "2", unit: "kg" }],
      },
    }),
  );

  await openStock(page);
  await page.getByRole("searchbox", { name: "Buscar" }).fill(label);
  await rowOf(page, isMobile, tomato)
    .getByRole("link", { name: tomato })
    .click();
  await arrivedAt(page, tomato);
  await rowOf(page, isMobile, "-2 kg")
    .getByRole("link", { name: "Merma" })
    .click();
  await arrivedAt(page, `Merma del ${today()}`);
  await expect(page.getByRole("main")).toContainText("Caducado");
  await expect(movementsOf(page)).toContainText(
    "Merma · -2 kg · Cámara frigorífica · 1,80 €/kg",
  );

  await page.getByRole("button", { name: "Anular" }).click();
  const confirm = page.getByRole("dialog", { name: "¿Anular esta merma?" });
  await confirm.getByRole("button", { name: "Anular" }).click();
  const reversal = page.getByRole("region", { name: "Anulación" });
  await expect(reversal).toContainText(
    `Anulación registrada el ${today()} por Local keeper.`,
  );
  await expect(reversal).toContainText(
    "Merma · +2 kg · Cámara frigorífica · 1,80 €/kg",
  );
  await expect(page.getByRole("button", { name: "Anular" })).toHaveCount(0);
  await expectAccessible(page);

  await openStock(page);
  await page.getByRole("searchbox", { name: "Buscar" }).fill(label);
  await expect(rowOf(page, isMobile, tomato)).toContainText("5 kg");
});
