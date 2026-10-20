import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";

// The seed's local-only logins (README, "Database"). Obviously fake: never reuse them anywhere real.
export const accounts = {
  counter: { email: "counter@example.test", password: "local-only-counter" }, // gitleaks:allow
  office: { email: "office@example.test", password: "local-only-office" }, // gitleaks:allow
  owner: { email: "owner@example.test", password: "local-only-owner" }, // gitleaks:allow
  // Only the language test signs in with it: it changes the user's saved language.
  staff: { email: "staff@example.test", password: "local-only-staff" }, // gitleaks:allow
  // A second owner, for the one test that needs an owner's view of documents (#106): it sets up
  // this account's 2FA itself, leaving `owner` to the 2FA test.
  manager: { email: "manager@example.test", password: "local-only-manager" }, // gitleaks:allow
};

export async function signIn(
  page: Page,
  { email, password }: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await submitSignIn(page, { email, password });
}

/** Fills in and sends the sign-in form on the page as it is, in Spanish (the default). */
export async function submitSignIn(
  page: Page,
  { email, password }: { email: string; password: string },
  text = SPANISH_SIGN_IN,
): Promise<void> {
  await expect(page.getByRole("heading", { name: text.title })).toBeVisible();
  await page.getByLabel(text.email).fill(email);
  await page.getByLabel(text.password, { exact: true }).fill(password);
  await page.getByRole("button", { name: text.submit }).click();
}

/**
 * Sets up 2FA on the setup page an owner without it is sent to, and waits for the home page:
 * confirms the password, reads the key shown for typing by hand, and enters its current code.
 * Answers the key.
 */
export async function setUpTwoFactor(
  page: Page,
  password: string,
  check: (page: Page) => Promise<void> = async () => {},
): Promise<string> {
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Continuar" }).click();
  const key = (await page.getByTestId("totp-key").textContent())?.trim();
  expect(key).toMatch(/^[A-Z2-7]+=*$/);
  await check(page);

  await page.getByLabel("Código de la app").fill(totpCode(key!));
  await page
    .getByRole("button", { name: "Activar la verificación", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
  return key!;
}

export const SPANISH_SIGN_IN = {
  title: "Iniciar sesión",
  email: "Correo electrónico",
  password: "Contraseña",
  submit: "Entrar",
};

export const ENGLISH_SIGN_IN = {
  title: "Sign in",
  email: "Email",
  password: "Password",
  submit: "Sign in",
};

function base32Decode(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("not base32");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** The 6-digit TOTP code an authenticator app would show now (RFC 6238, SHA-1, 30 s). */
export function totpCode(base32Secret: string, time = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(base32Secret))
    .update(counter)
    .digest();
  const offset = hmac.readUInt8(hmac.length - 1) & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}
