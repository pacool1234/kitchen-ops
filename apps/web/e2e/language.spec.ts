import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, ENGLISH_SIGN_IN, signIn, submitSignIn } from "./accounts.ts";
import { chooseLanguageSignedIn, chooseLanguageSignedOut } from "./shell.ts";

// The interface's language (#86): Spanish by default, English second, saved per user.

/** `<html lang>`, which screen readers use to pick a voice (WCAG 3.1.1). */
const expectPageLanguage = (page: Page, locale: "es" | "en") =>
  expect(page.locator("html")).toHaveAttribute("lang", locale);

const heading = (page: Page, name: string) =>
  page.getByRole("heading", { name, level: 1 });

test("the sign-in page switches to English and back, and this device remembers it", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(heading(page, "Iniciar sesión")).toBeVisible();
  await expectPageLanguage(page, "es");

  await chooseLanguageSignedOut(page, "English");
  await expect(heading(page, "Sign in")).toBeVisible();
  await expectPageLanguage(page, "en");
  await expect(page).toHaveTitle("Sign in · kitchen-ops");
  await expectAccessible(page);

  await page.reload();
  await expect(heading(page, "Sign in")).toBeVisible();
  await expectPageLanguage(page, "en");

  await chooseLanguageSignedOut(page, "Español");
  await expect(heading(page, "Iniciar sesión")).toBeVisible();
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
    await chooseLanguageSignedOut(page, "English");
    await submitSignIn(page, accounts.staff, ENGLISH_SIGN_IN);
    await expect(heading(page, "Home")).toBeVisible();
    await expectPageLanguage(page, "en");
    await expectAccessible(page);

    // Another device, new to the app, shows the sign-in page in Spanish. Once the user signs
    // in, it shows their language.
    const otherDevice = await browser.newContext({ baseURL });
    const other = await otherDevice.newPage();
    await signIn(other, accounts.staff);
    await expect(heading(other, "Home")).toBeVisible();

    // Switched back there, in the user menu, it's saved again...
    const saved = other.waitForResponse(
      (r) => r.url().endsWith("/api/me") && r.request().method() === "PATCH",
    );
    await chooseLanguageSignedIn(other, "Español");
    expect((await saved).status()).toBe(200);
    await expect(heading(other, "Inicio")).toBeVisible();
    await otherDevice.close();

    // ...and the first device follows the user, though it last showed English.
    await page.reload();
    await expect(heading(page, "Inicio")).toBeVisible();
    await expectPageLanguage(page, "es");
  });
});
