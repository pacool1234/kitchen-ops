import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";

// The seed's local-only logins (README, "Database"). Obviously fake: never reuse them anywhere real.
export const accounts = {
  counter: { email: "counter@example.test", password: "local-only-counter" }, // gitleaks:allow
  office: { email: "office@example.test", password: "local-only-office" }, // gitleaks:allow
  owner: { email: "owner@example.test", password: "local-only-owner" }, // gitleaks:allow
};

export async function signIn(
  page: Page,
  { email, password }: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

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
