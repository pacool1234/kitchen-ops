import {
  buildPath,
  ErrorBody,
  type Endpoint,
  type FieldErrorCode,
} from "@kitchen-ops/shared";
import type { z } from "zod";

// Calls to our API, through the contract in packages/shared (decision 0022): the path, its
// parameters, the query and the body are typed by the endpoint, and every response is validated
// with the endpoint's schema, so the web app never trusts data that doesn't match its types.

/**
 * An API call that did not return the expected data. `code` is the API's `error` field, and
 * `fields` the code of each field it refused (decision 0026), for a form to show by each field.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Readonly<Record<string, FieldErrorCode>> | undefined;

  constructor(
    status: number,
    code: string,
    fields?: Readonly<Record<string, FieldErrorCode>>,
  ) {
    super(`API ${status}: ${code}`);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** What a call to `E` takes: its path parameters, query and body, each only if it has them. */
export type CallInput<E extends Endpoint> = (E extends {
  params: infer P extends z.ZodType;
}
  ? { params: z.input<P> }
  : { params?: undefined }) &
  (E extends { query: infer Q extends z.ZodType }
    ? { query?: z.input<Q> }
    : { query?: undefined }) &
  (E extends { body: infer B extends z.ZodType }
    ? { body: z.input<B> }
    : { body?: undefined });

/** Calls an endpoint of the contract and returns its validated response. Throws `ApiError`. */
export async function call<E extends Endpoint>(
  endpoint: E,
  ...[input]: object extends CallInput<E>
    ? [input?: CallInput<E>]
    : [input: CallInput<E>]
): Promise<z.output<E["response"]>> {
  const { params, query, body } = (input ?? {}) as {
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: unknown;
  };

  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.append(name, String(value));
  }
  const path = buildPath(endpoint.path, params ?? {});
  const url = search.size > 0 ? `${path}?${search}` : path;

  const response = await fetch(url, {
    method: endpoint.method,
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const errorBody: unknown = await response.json().catch(() => null);
    // Fields only if every code is one the app knows: a form never shows an unknown one.
    const parsed = ErrorBody.safeParse(errorBody);
    if (parsed.success) {
      throw new ApiError(
        response.status,
        parsed.data.error,
        parsed.data.fields,
      );
    }
    const code =
      errorBody && typeof errorBody === "object" && "error" in errorBody
        ? String(errorBody.error)
        : response.statusText;
    throw new ApiError(response.status, code);
  }
  const parsed = endpoint.response.safeParse(await response.json());
  if (!parsed.success) {
    throw new ApiError(response.status, "unexpected_response");
  }
  return parsed.data as z.output<E["response"]>;
}
