import { expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y.ts";
import { accounts, setUpTwoFactor, signIn } from "./accounts.ts";

// Setting up 2FA changes the seeded owner for the rest of the run, so it runs once, at desktop
// size: owners work at a desk (spec section 11.1). The other tests never sign in as the owner.
test.skip(
  ({ isMobile }) => isMobile,
  "the owner's 2FA setup runs once, at desktop size",
);

test("an owner without 2FA is sent to set it up, and gets in once it's on", async ({
  page,
}) => {
  await signIn(page, accounts.owner);
  await expect(
    page.getByRole("heading", { name: "Activar la verificación en dos pasos" }),
  ).toBeVisible();
  await expectAccessible(page);

  // Even typed by hand, the products stay closed until 2FA is on.
  await page.goto("/products");
  await expect(
    page.getByRole("heading", { name: "Activar la verificación en dos pasos" }),
  ).toBeVisible();

  await setUpTwoFactor(page, accounts.owner.password, expectAccessible);
});
