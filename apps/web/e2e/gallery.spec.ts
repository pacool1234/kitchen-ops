import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";

// The component gallery (#85): every component, in every state, checked with axe in light and
// dark, and worked with the keyboard alone. It exists in development and browser-test builds
// only (decision 0024).

async function openGallery(page: Page) {
  await page.goto("/gallery");
  await expect(
    page.getByRole("heading", { name: "Galería de componentes", level: 1 }),
  ).toBeVisible();
}

const section = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });

test("the gallery passes axe, in light and in dark", async ({ page }) => {
  await openGallery(page);
  await expectAccessible(page);

  await page.emulateMedia({ colorScheme: "dark" });
  // The dark canvas, so the second check really is of the dark theme.
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(17, 21, 19)",
  );
  await expectAccessible(page);
});

test("Tab reaches every control, and each shows the focus ring", async ({
  page,
}) => {
  await openGallery(page);
  // Marks each element that gets focus, and whether a 2px ring showed on it, or on the
  // frame around it for a combobox's input.
  await page.evaluate(() => {
    document.addEventListener("focusin", (event) => {
      const element = event.target as HTMLElement;
      const ringed = element.closest("[data-focus-frame]") ?? element;
      const style = getComputedStyle(ringed);
      const visible =
        style.outlineStyle !== "none" &&
        Number.parseFloat(style.outlineWidth) >= 2;
      element.dataset.wasFocused = visible ? "ring" : "no-ring";
    });
  });

  for (let i = 0; i < 150; i += 1) await page.keyboard.press("Tab");

  const noRing = await page.locator('[data-was-focused="no-ring"]').count();
  expect(noRing, "elements focused without a visible ring").toBe(0);

  for (const control of [
    page.getByRole("button", { name: "Guardar", exact: true }),
    page.getByRole("textbox", { name: "Nombre del producto" }),
    page.getByRole("textbox", { name: "Cantidad" }),
    page.getByRole("combobox", { name: "Unidad base" }),
    page.getByRole("combobox", { name: "Producto", exact: true }),
    page.getByRole("checkbox", { name: "Activo" }),
    page.getByRole("switch", { name: "Avisar cuando falte stock" }),
    page.getByRole("button", { name: "Eliminar producto" }),
    page.getByRole("tab", { name: "General" }),
    page.getByRole("button", { name: "Nombre" }),
    page.getByRole("button", { name: "Página siguiente" }),
  ]) {
    await expect(control).toHaveAttribute("data-was-focused", "ring");
  }
});

test("buttons answer Enter and Space; disabled ones are skipped", async ({
  page,
}) => {
  await openGallery(page);
  const buttons = section(page, "Botones");
  const save = buttons.getByRole("button", { name: "Guardar", exact: true });
  await save.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect(buttons.getByText("Pulsado 2 veces")).toBeVisible();
  await expect(
    buttons.getByRole("button", { name: "No disponible" }),
  ).toBeDisabled();
});

test("a checkbox and a switch toggle with Space", async ({ page }) => {
  await openGallery(page);
  const active = page.getByRole("checkbox", { name: "Activo" });
  await active.focus();
  await page.keyboard.press("Space");
  await expect(active).toBeChecked();

  const alert = page.getByRole("switch", { name: "Avisar cuando falte stock" });
  await alert.focus();
  await page.keyboard.press("Space");
  await expect(alert).toHaveAttribute("aria-checked", "true");
});

test("a number field reads a Spanish decimal exactly, and explains what it refuses", async ({
  page,
}) => {
  await openGallery(page);
  const numbers = section(page, "Campos numéricos");
  const quantity = numbers.getByRole("textbox", { name: "Cantidad" });

  await quantity.fill("2,5678");
  await quantity.press("Tab");
  await expect(quantity).toHaveAttribute("aria-invalid", "true");
  // The error is read with the field, not only shown near it.
  await expect(quantity).toHaveAccessibleDescription(
    /Escribe como mucho 3 decimales/,
  );

  await quantity.fill("2,5");
  await quantity.press("Tab");
  await expect(quantity).not.toHaveAttribute("aria-invalid");
  await expect(numbers.getByText("Valor: 2.5", { exact: true })).toBeVisible();
});

test("a select opens, moves and chooses with the keyboard", async ({
  page,
}) => {
  await openGallery(page);
  const unit = page.getByRole("combobox", { name: "Unidad base" });
  await unit.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(unit).toHaveText(/Unidades/);
});

test("a combobox finds by typing, without accents or capitals", async ({
  page,
}) => {
  await openGallery(page);
  const product = page.getByRole("combobox", { name: "Producto", exact: true });
  await product.fill("limon");
  await expect(page.getByRole("option", { name: "Limón" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Tomate" })).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(product).toHaveValue("Limón");

  await product.fill("zzz");
  await expect(page.getByText("No hay resultados.")).toBeVisible();
});

test("a dialog takes focus, closes with Escape, and gives focus back", async ({
  page,
}) => {
  await openGallery(page);
  const open = page.getByRole("button", { name: "Eliminar producto" });
  await open.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "¿Eliminar el producto?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await expectAccessible(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test("tabs move with the arrow keys, skipping a disabled one", async ({
  page,
}) => {
  await openGallery(page);
  await page.getByRole("tab", { name: "General" }).focus();
  await page.keyboard.press("ArrowRight");
  const units = page.getByRole("tab", { name: "Unidades" });
  await expect(units).toBeFocused();
  await expect(units).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("1 caja = 6 kg");

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Proveedores" })).toBeFocused();
});

test("an error notice is shown and announced, and stays until it's closed", async ({
  page,
}) => {
  await openGallery(page);
  await page.getByRole("button", { name: "Aviso de error" }).click();
  const notice = page.getByText("No se ha podido guardar el pedido", {
    exact: true,
  });
  await expect(notice.first()).toBeVisible();
  await page.getByRole("button", { name: "Cerrar el aviso" }).click();
  await expect(notice).toHaveCount(0);
});

test("the table sorts from its headers with the keyboard, and pages", async ({
  page,
}) => {
  await openGallery(page);
  const table = page.getByRole("table", { name: "Productos" });
  const nameHeader = table.getByRole("columnheader", { name: "Nombre" });
  const firstName = table.getByRole("row").nth(1).getByRole("cell").first();

  await nameHeader.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
  await expect(firstName).toHaveText("Aceite de girasol");

  await page.keyboard.press("Enter");
  await expect(nameHeader).toHaveAttribute("aria-sort", "descending");
  await expect(firstName).toHaveText("Zanahoria");

  const pages = page.getByRole("navigation", { name: "Páginas" });
  await expect(pages).toContainText("1–10 de 42");
  await expect(pages).toContainText("Página 1 de 5");
  await pages.getByRole("button", { name: "Página siguiente" }).focus();
  await page.keyboard.press("Enter");
  await expect(pages).toContainText("11–20 de 42");
  await expect(pages).toContainText("Página 2 de 5");
});

test("the components' own text follows the language", async ({ page }) => {
  await openGallery(page);
  await page.getByLabel("Idioma").selectOption("en");
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages).toContainText("Page 1 of 5");
  await expect(pages).toContainText("1–10 of 42");
});
