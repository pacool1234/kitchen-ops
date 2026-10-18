import type { FieldErrorCode } from "@kitchen-ops/shared";
import { ApiError } from "../api";
import type { MessageKey } from "./index";
import { es, type Messages } from "./messages/es";

/**
 * The message for a failed call. The API answers with a code (`forbidden`), never with text
 * (#86): a code the app has a message for gets it, anything else the general one.
 */
type ErrorCode = Exclude<keyof Messages["errors"], "fields">;

export function errorMessageKey(error: unknown): `errors.${ErrorCode}` {
  if (
    error instanceof ApiError &&
    Object.hasOwn(es.errors, error.code) &&
    typeof es.errors[error.code as ErrorCode] === "string"
  ) {
    return `errors.${error.code as ErrorCode}`;
  }
  return "errors.unknown";
}

/** The message for a refused field: its code's, or a field's own wording for it. */
export function fieldMessageKey(
  code: FieldErrorCode,
  own: Partial<Record<FieldErrorCode, MessageKey>> = {},
): MessageKey {
  return own[code] ?? `errors.fields.${code}`;
}
