import { endpoints, type MeResponse } from "@kitchen-ops/shared";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/vue";
import { ApiError, call } from "./api";

/** Better Auth's browser client: sign-in, the TOTP step, 2FA setup, sign-out (/api/auth/*). */
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});

export type Me = MeResponse;

/**
 * Who is signed in, or why not:
 * - a user;
 * - "signed-out" (401);
 * - "two-factor-required" (owner who has not set up 2FA yet, 403).
 */
export async function whoAmI(): Promise<
  Me | "signed-out" | "two-factor-required"
> {
  try {
    return await call(endpoints.me);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return "signed-out";
    if (error instanceof ApiError && error.code === "two_factor_required") {
      return "two-factor-required";
    }
    throw error;
  }
}
