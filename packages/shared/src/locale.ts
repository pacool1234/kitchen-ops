import { z } from "zod";

/** The interface languages (spec section 11.1): Spanish first, English second. */
export const LOCALES = ["es", "en"] as const;
export const Locale = z.enum(LOCALES);
export type Locale = z.infer<typeof Locale>;

/** The language a user gets until they choose another. */
export const DEFAULT_LOCALE: Locale = "es";
