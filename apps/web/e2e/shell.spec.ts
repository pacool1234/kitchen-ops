import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, signIn } from "./accounts.ts";
import { mainNav, openUserMenu } from "./shell.ts";

// The app's frame (#85): navigation by device and role, the page's title and breadcrumb, focus
// after each navigation, the skip link, and the user menu.

const title = (page: Page) => page.getByRole("heading", { level: 1 });

async function signedIn(page: Page) {
  await signIn(page, accounts.counter);
  // Signing in hashes the password: slow while many tests sign in at once.
  await expect(title(page)).toHaveText("Inicio", { timeout: 15_000 });
}

test("a desktop has the sidebar and a phone the bottom bar, never both", async ({
  page,
  isMobile,
}) => {
  await signedIn(page);
  await expect(mainNav(page)).toHaveCount(1);
  await expect(page.locator("[data-bottom-nav]")).toBeVisible({
    visible: isMobile,
  });
  await expect(page.locator("aside nav")).toBeVisible({ visible: !isMobile });
});

test("navigating moves focus to the new page's title, and names the page everywhere", async ({
  page,
}) => {
  await signedIn(page);
  await expect(page).toHaveTitle("Inicio · kitchen-ops");

  // The catalogue opens on its products; its item stays marked on every page inside it.
  const catalogue = mainNav(page).getByRole("link", { name: "Catálogo" });
  await catalogue.click();
  await expect(title(page)).toHaveText("Productos");
  await expect(title(page)).toBeFocused();
  await expect(catalogue).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveTitle("Productos · kitchen-ops");

  // The breadcrumb leads back up.
  const breadcrumb = page.getByRole("navigation", { name: "Estás en" });
  await expect(breadcrumb.getByText("Productos")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    breadcrumb.getByRole("link", { name: "Catálogo" }),
  ).toBeVisible();
  await breadcrumb.getByRole("link", { name: "Inicio" }).click();
  await expect(title(page)).toHaveText("Inicio");
  await expect(title(page)).toBeFocused();
});

test("the home page has a shortcut to each place the user can go", async ({
  page,
}) => {
  await signedIn(page);
  await page
    .getByRole("main")
    .getByRole("link", { name: /Catálogo.*Productos, proveedores y almacenes/ })
    .click();
  await expect(title(page)).toHaveText("Productos");
});

test("the first Tab reaches the skip link, which goes straight to the content", async ({
  page,
}) => {
  await signedIn(page);
  await page.reload();
  await expect(title(page)).toHaveText("Inicio");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#content")).toBeFocused();
});

test("the user menu works with the keyboard, and signs out", async ({
  page,
}) => {
  await signedIn(page);
  const trigger = page.getByRole("button", { name: /Menú de usuario/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Local counter");
  await expect(menu).toContainText("counter@example.test");
  await expect(menu).toContainText("Personal");
  await expectAccessible(page);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", { name: "Cerrar sesión" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(title(page)).toHaveText("Iniciar sesión");
  await page.goto("/");
  await expect(title(page)).toHaveText("Iniciar sesión");
});

test("on a phone, the bottom bar never covers the end of the page", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "the bottom bar is a phone's");
  // A short screen, so the page is longer than it and its end has to scroll up past the bar.
  await page.setViewportSize({ width: 412, height: 480 });
  await signedIn(page);
  await mainNav(page).getByRole("link", { name: "Catálogo" }).click();
  // A full page of the seed's products: 20 cards, on a phone.
  const cards = page.getByRole("list", { name: "Productos" });
  await expect(cards.getByRole("listitem")).toHaveCount(20);

  await page.mouse.wheel(0, 10_000);
  await expect(async () => {
    const end = await page.locator("main#content > *").last().boundingBox();
    const bar = await page.locator("[data-bottom-nav]").boundingBox();
    expect(end!.y + end!.height).toBeLessThanOrEqual(bar!.y);
  }).toPass();
});

test("every page of the frame passes axe, in light and in dark", async ({
  page,
}) => {
  await signedIn(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(title(page)).toHaveText("Inicio");
    await expectAccessible(page);
    // The old address of the product list still leads to it.
    await page.goto("/products");
    await expect(title(page)).toHaveText("Productos");
    await expect(page.getByText("Aceite de oliva virgen extra")).toBeVisible();
    await expectAccessible(page);
    await openUserMenu(page);
    await expectAccessible(page);
  }
});
