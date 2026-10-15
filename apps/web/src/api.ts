import type { z } from "zod";

/** An API call that did not return the expected data. `code` is the API's `error` field. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`API ${status}: ${code}`);
    this.status = status;
    this.code = code;
  }
}

/**
 * GET from our API and validate the response with the shared Zod schema, so the web app never
 * trusts a response that does not match the types it was written against.
 */
export async function apiGet<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.infer<T>> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : response.statusText;
    throw new ApiError(response.status, code);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ApiError(response.status, "unexpected_response");
  }
  return parsed.data;
}
