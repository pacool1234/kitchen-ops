import { expect, type Page } from "@playwright/test";

// Using the app's frame (#85): its navigation, the user menu and the language menus.

/** The main navigation that's showing: the sidebar on a desktop, the bottom bar on a phone. */
export const mainNav = (page: Page) =>
  page.getByRole("navigation", { name: /^(Principal|Main)$/ });

/** Opens the user menu, whatever the language. */
export async function openUserMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Menú de usuario|User menu/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: /Cerrar sesión|Sign out/ }).click();
}

/** Picks a language in the user menu, saved as the signed-in user's. */
export async function chooseLanguageSignedIn(
  page: Page,
  language: "Español" | "English",
): Promise<void> {
  await openUserMenu(page);
  await page.getByRole("menuitemradio", { name: language }).click();
}

/** Picks a language in the sign-in pages' menu, named "Idioma: Español" or "Language: English". */
export async function chooseLanguageSignedOut(
  page: Page,
  language: "Español" | "English",
): Promise<void> {
  await page.getByRole("button", { name: /^(Idioma|Language):/ }).click();
  await page.getByRole("menuitemradio", { name: language }).click();
}
