import type { Role } from "@kitchen-ops/shared";
import type { FastifyInstance } from "fastify";
import type { Auth } from "../auth/auth";
import { createUser } from "../auth/users";
import { totpCode } from "./helpers";

export const TEST_PASSWORD = "test-only-password";

/** Turns an inject() response's cookies into a Cookie header for the next request. */
export function cookieHeader(response: {
  cookies: { name: string; value: string }[];
}) {
  return response.cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

const origin = (auth: Auth) => (auth.options.baseURL as string) ?? "";

/**
 * Turns on TOTP for a signed-in user, as the authenticator-app setup would. Returns the secret,
 * and the session cookie to use from then on.
 */
export async function enableTotp(
  app: FastifyInstance,
  auth: Auth,
  cookie: string,
): Promise<{ secret: string; cookie: string }> {
  const post = (url: string, payload: object) =>
    app.inject({
      method: "POST",
      url,
      headers: { cookie, origin: origin(auth) },
      payload,
    });
  const enabled = await post("/api/auth/two-factor/enable", {
    password: TEST_PASSWORD,
  });
  if (enabled.statusCode !== 200) {
    throw new Error(`enabling 2FA answered ${enabled.statusCode}`);
  }
  const secret = new URL(
    enabled.json<{ totpURI: string }>().totpURI,
  ).searchParams.get("secret");
  if (!secret) throw new Error("no secret in totpURI");

  const verified = await post("/api/auth/two-factor/verify-totp", {
    code: totpCode(secret),
  });
  if (verified.statusCode !== 200) {
    throw new Error(`verifying the TOTP code answered ${verified.statusCode}`);
  }
  return { secret, cookie: cookieHeader(verified) || cookie };
}

/** Creates an owner, signs in and sets up 2FA (owners must), and returns its session cookie. */
export async function signedInAsOwner(
  app: FastifyInstance,
  auth: Auth,
): Promise<string> {
  const email = "owner@example.test";
  await createUser(auth, {
    email,
    name: "Test owner",
    role: "owner",
    password: TEST_PASSWORD,
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: origin(auth) },
    payload: { email, password: TEST_PASSWORD },
  });
  return (await enableTotp(app, auth, cookieHeader(response))).cookie;
}

/** Creates a user with this role and returns a signed-in session cookie for it. */
export async function signedInAs(
  app: FastifyInstance,
  auth: Auth,
  role: Exclude<Role, "owner">,
) {
  const email = `${role}@example.test`;
  await createUser(auth, {
    email,
    name: `Test ${role}`,
    role,
    password: TEST_PASSWORD,
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: (auth.options.baseURL as string) ?? "" },
    payload: { email, password: TEST_PASSWORD },
  });
  return cookieHeader(response);
}
