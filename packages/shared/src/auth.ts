import { z } from "zod";

/** Roles from spec section 6, least privileged first. */
export const ROLES = ["counter", "office", "owner"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/** Response of `GET /api/me`: who is signed in. */
export const MeResponse = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: Role,
});
export type MeResponse = z.infer<typeof MeResponse>;
