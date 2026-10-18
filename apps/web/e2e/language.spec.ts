import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, ENGLISH_SIGN_IN, signIn, submitSignIn } from "./accounts.ts";

// The interface's language (#86): Spanish by default, English second, saved per user.

/** Picks a language in the language menu, whose label is in the language shown now. */
async function chooseLanguage(page: Page, label: string, locale: "es" | "en") {
  await page.getByLabel(label).selectOption(locale);
}

/** `<html lang>`, which screen readers use to pick a voice (WCAG 3.1.1). */
const expectPageLanguage = (page: Page, locale: "es" | "en") =>
  expect(page.locator("html")).toHaveAttribute("lang", locale);

test("the sign-in page switches to English and back, and this device remembers it", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
  await expectPageLanguage(page, "es");

  await chooseLanguage(page, "Idioma", "en");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectPageLanguage(page, "en");
  await expectAccessible(page);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectPageLanguage(page, "en");

  await chooseLanguage(page, "Language", "es");
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
  await expectPageLanguage(page, "es");
});

test.describe("each user's own language", () => {
  // It changes the seeded staff user's saved language, so it runs once, at desktop size.
  test.skip(
    ({ isMobile }) => isMobile,
    "saving a user's language runs once, at desktop size",
  );

  test("is saved as theirs, and follows them to another device", async ({
    page,
    browser,
    baseURL,
  }) => {
    // Chosen on the sign-in page, then saved as the user's when they sign in.
    await page.goto("/login");
    await chooseLanguage(page, "Idioma", "en");
    await submitSignIn(page, accounts.staff, ENGLISH_SIGN_IN);
    await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
    await expectPageLanguage(page, "en");
    await expectAccessible(page);

    // Another device, new to the app, shows the sign-in page in Spanish. Once the user signs
    // in, it shows their language.
    const otherDevice = await browser.newContext({ baseURL });
    const other = await otherDevice.newPage();
    await signIn(other, accounts.staff);
    await expect(
      other.getByRole("heading", { name: "Products" }),
    ).toBeVisible();

    // Switched back there, it's saved again...
    const saved = other.waitForResponse(
      (r) => r.url().endsWith("/api/me") && r.request().method() === "PATCH",
    );
    await chooseLanguage(other, "Language", "es");
    expect((await saved).status()).toBe(200);
    await expect(
      other.getByRole("heading", { name: "Productos" }),
    ).toBeVisible();
    await otherDevice.close();

    // ...and the first device follows the user, though it last showed English.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Productos" }),
    ).toBeVisible();
    await expectPageLanguage(page, "es");
  });
});
