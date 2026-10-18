import { z } from "zod";
import { Locale } from "./locale";

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
  locale: Locale,
});
export type MeResponse = z.infer<typeof MeResponse>;

/** Body of `PATCH /api/me`: what users may change about themselves. Only their language, so far. */
export const UpdateMe = z.strictObject({ locale: Locale });
export type UpdateMe = z.infer<typeof UpdateMe>;
