import type { Role } from "@kitchen-ops/shared";
import type { FastifyInstance } from "fastify";
import type { Auth } from "../auth/auth";
import { createUser } from "../auth/users";

export const TEST_PASSWORD = "test-only-password";

/** Turns an inject() response's cookies into a Cookie header for the next request. */
export function cookieHeader(response: {
  cookies: { name: string; value: string }[];
}) {
  return response.cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
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
