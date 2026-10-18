import { expect, type Page, type TestInfo } from "@playwright/test";
import { signIn } from "./accounts.ts";
import { mainNav } from "./shell.ts";

// Using the catalogue (#89). The desktop and phone runs share one database at the same time, so
// every test names what it creates uniquely, and gives each supplier its own tax ID.

/** A name no other test, or the other screen size's run of this one, uses. */
export function unique(testInfo: TestInfo, name: string): string {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  return `${name} ${testInfo.project.name} ${stamp}`;
}

/**
 * A valid CIF for a fictional company, almost surely one no other test uses: "B00", five
 * random digits and the control digit. Province 00 doesn't exist, so it's no real company's.
 */
export function syntheticCif(): string {
  const digits = `00${String(Math.floor(Math.random() * 100_000)).padStart(5, "0")}`;
  let sum = 0;
  [...digits].forEach((character, i) => {
    const doubled = 2 * Number(character);
    sum +=
      i % 2 === 1
        ? Number(character)
        : Math.floor(doubled / 10) + (doubled % 10);
  });
  return `B${digits}${(10 - (sum % 10)) % 10}`;
}

/**
 * Signs in, and waits for the home page: the session is set once it shows. Signing in hashes
 * the password, which is slow while many tests sign in at once, so it's given longer.
 */
export async function signedIn(
  page: Page,
  account: { email: string; password: string },
): Promise<void> {
  await signIn(page, account);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inicio", {
    timeout: 15_000,
  });
}

/**
 * Waits until the page titled `title` has arrived: after each navigation the app moves focus
 * to the title, which would close a select a test had already opened.
 */
export async function arrivedAt(page: Page, title: string): Promise<void> {
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(title);
  await expect(heading).toBeFocused();
}

export type CatalogueSection = "Productos" | "Proveedores" | "Almacenes";

/** Opens the catalogue from the main navigation, then one of its sections. */
export async function openCatalogue(
  page: Page,
  section: CatalogueSection,
): Promise<void> {
  await mainNav(page).getByRole("link", { name: "Catálogo" }).click();
  await page
    .getByRole("navigation", { name: "Secciones del catálogo" })
    .getByRole("link", { name: section })
    .click();
  await arrivedAt(page, section);
}

/** Picks an option of a select, by the field's label and the option's text. */
export async function choose(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Creates a supplier through the API as the signed-in user: quicker than the form. */
export async function createSupplier(
  page: Page,
  body: { name: string; taxId: string; email?: string },
): Promise<{ id: string }> {
  const response = await page.request.post("/api/suppliers", { data: body });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string };
}

/** Creates a product through the API as the signed-in user. */
export async function createProduct(
  page: Page,
  body: {
    name: string;
    baseUnit: "g" | "ml" | "unit";
    category: string;
    conversions?: { unit: string; factor: number }[];
  },
): Promise<{ id: string }> {
  const response = await page.request.post("/api/products", { data: body });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string };
}

/** Creates a supplier product through the API as the signed-in user. */
export async function createSupplierProduct(
  page: Page,
  body: {
    supplierId: string;
    code: string;
    description: string;
    productId: string;
    pack: { quantity: string; unit: string };
  },
): Promise<{ id: string }> {
  const response = await page.request.post("/api/supplier-products", {
    data: body,
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string };
}
