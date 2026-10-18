import { DEFAULT_LOCALE, LOCALES, ROLES } from "@kitchen-ops/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import type { Config } from "../config";
import type { Db } from "../db/client";
import {
  accounts,
  sessions,
  twoFactors,
  users,
  verifications,
} from "../db/schema";

export const AUTH_BASE_PATH = "/api/auth";

/** Better Auth: email + password, sessions in Postgres, TOTP 2FA (decision 0006). */
export function createAuth(
  db: Db,
  config: Pick<Config, "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL">,
) {
  return betterAuth({
    appName: "kitchen-ops", // shown as the issuer in authenticator apps
    baseURL: config.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        twoFactor: twoFactors,
      },
    }),
    // No public sign-up: staff accounts are created by the seed now, by an owner later.
    emailAndPassword: { enabled: true, disableSignUp: true },
    user: {
      additionalFields: {
        // input: false, so no API call can set or change a role.
        role: {
          type: [...ROLES],
          required: true,
          defaultValue: "counter",
          input: false,
        },
        // Changed only through PATCH /api/me, which validates it with the contract's schema.
        locale: {
          type: [...LOCALES],
          required: true,
          defaultValue: DEFAULT_LOCALE,
          input: false,
        },
      },
    },
    // Our tables create their own IDs (UUID v7, decision 0011).
    advanced: { database: { generateId: false } },
    plugins: [twoFactor()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
