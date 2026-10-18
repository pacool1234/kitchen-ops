import type { FastifyInstance } from "fastify";
import type { z } from "zod";

/**
 * A valid CIF for a fictional company, different for each `n` (0 to 99 999): "B00" and `n`, then
 * the control digit. Province 00 doesn't exist, so it belongs to no real company.
 */
export function syntheticCif(n: number): string {
  const digits = `00${String(n).padStart(5, "0")}`;
  let sum = 0;
  [...digits].forEach((character, i) => {
    const doubled = 2 * Number(character);
    sum +=
      i % 2 === 1
        ? Number(character)
        : Math.floor(doubled / 10) + (doubled % 10);
  });
  return `B${digits}${(10 - (sum % 10)) % 10}`;
}

/** Calls the API as one signed-in user: `send` any request, or expect a create or a read to work. */
export function apiAs(app: FastifyInstance, cookie: string) {
  const send = (
    method: "GET" | "POST" | "PATCH",
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: { cookie },
      ...(payload ? { payload } : {}),
    });
  const expecting = async <T>(
    status: number,
    response: Awaited<ReturnType<typeof send>>,
    schema: z.ZodType<T>,
  ) => {
    if (response.statusCode !== status) {
      throw new Error(
        `expected ${status}, got ${response.statusCode}: ${response.body}`,
      );
    }
    return schema.parse(response.json());
  };
  return {
    send,
    created: async <T>(url: string, body: object, schema: z.ZodType<T>) =>
      expecting(201, await send("POST", url, body), schema),
    read: async <T>(url: string, schema: z.ZodType<T>) =>
      expecting(200, await send("GET", url), schema),
    updated: async <T>(url: string, body: object, schema: z.ZodType<T>) =>
      expecting(200, await send("PATCH", url, body), schema),
  };
}
