import type { Role } from "@kitchen-ops/shared";
import type { Auth } from "./auth";

export interface NewUser {
  email: string;
  name: string;
  role: Role;
  password: string;
}

/**
 * Creates a user with an email + password login, bypassing the disabled public sign-up.
 * Server-side only: used by the seed and tests now, by "manage users" (owner) later.
 */
export async function createUser(auth: Auth, user: NewUser) {
  const ctx = await auth.$context;
  const created = await ctx.internalAdapter.createUser(
    {
      email: user.email.toLowerCase(),
      name: user.name,
      role: user.role,
      emailVerified: true,
    },
    { method: "admin" }, // created by the server, not through sign-up
  );
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: await ctx.password.hash(user.password),
  });
  return created;
}
