import { ApiError } from "../api";
import { es, type Messages } from "./messages/es";

/**
 * The message for a failed call. The API answers with a code (`forbidden`), never with text
 * (#86): a code the app has a message for gets it, anything else the general one.
 */
export function errorMessageKey(
  error: unknown,
): `errors.${keyof Messages["errors"]}` {
  if (error instanceof ApiError && Object.hasOwn(es.errors, error.code)) {
    return `errors.${error.code as keyof Messages["errors"]}`;
  }
  return "errors.unknown";
}
