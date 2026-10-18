import { z } from "zod";

// Text fields as forms send them (#88): trimmed, and blank means none.

/** A name: required, at most 100 characters once trimmed. */
export const Name = z.string().trim().min(1).max(100);

const blankToNull = (text: string | null) => (text ? text : null);

/**
 * Text that may be left empty: trimmed, and blank or null is none (null). Wrap it in
 * `.optional()`: a field not sent is then left as it is, never cleared.
 */
export function optionalText(max: number) {
  return z.string().trim().max(max).nullable().transform(blankToNull);
}

/** An email address, or none. */
export const OptionalEmail = optionalText(254).pipe(z.email().nullable());

/** A phone number, or none: digits, spaces, and + ( ) . - only. */
export const OptionalPhone = optionalText(30).pipe(
  z
    .string()
    .regex(/^\+?[\d\s().-]+$/)
    .nullable(),
);
