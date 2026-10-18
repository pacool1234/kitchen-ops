import { z } from "zod";

// What a refused request answers (#88): a short code for the whole answer, which the web app
// translates (`forbidden`, `not_found`), and for invalid input one code per field, keyed by the
// field's path (`taxId`, `lines.1.quantity`), shown next to that field.

/** Why a field was refused. A closed list, so the web app can have a message for each. */
export const FIELD_ERROR_CODES = [
  /** Missing, or blank once trimmed. */
  "required",
  /** The wrong type, or not one of the values allowed. */
  "invalid",
  "too_short",
  "too_long",
  "too_small",
  "too_big",
  /** A field the endpoint doesn't take. */
  "unknown_field",
  "invalid_tax_id",
  /** A value that must be unique, already used (409). */
  "taken",
] as const;
export const FieldErrorCode = z.enum(FIELD_ERROR_CODES);
export type FieldErrorCode = z.infer<typeof FieldErrorCode>;

/** Every error answer: `error`, and `fields` for invalid input or a conflict. */
export const ErrorBody = z.object({
  error: z.string(),
  fields: z.record(z.string(), FieldErrorCode).optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** A refinement's options, so the field it refuses answers with this code. */
export function fieldError(code: FieldErrorCode) {
  return { params: { code } };
}
