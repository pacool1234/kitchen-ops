import { fieldError } from "@kitchen-ops/shared";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { HttpError, registerErrors } from "./errors";

// What every refused request answers (#88): a code for the whole answer, and one code per field
// for invalid input, which the web app turns into a message next to that field.

const app = Fastify().withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
registerErrors(app);

app.post(
  "/things",
  {
    schema: {
      querystring: z.object({
        page: z.coerce.number().int().min(1).optional(),
      }),
      body: z.strictObject({
        name: z.string().trim().min(1).max(5),
        count: z.number().int().min(0).max(10),
        lines: z
          .array(z.object({ quantity: z.number().positive() }))
          .optional(),
        code: z
          .string()
          .refine((c) => c === "ok", fieldError("invalid_tax_id"))
          .optional(),
      }),
    },
  },
  async () => ({ ok: true }),
);
app.get("/missing", async () => {
  throw new HttpError(404, "not_found");
});
// What Drizzle throws when Postgres refuses a duplicate: its error wraps Postgres's.
app.get("/duplicate/:constraint", async (request) => {
  const { constraint } = request.params as { constraint: string };
  throw new Error("Failed query: insert into …", {
    cause: Object.assign(new Error("duplicate key value"), {
      code: "23505",
      constraint,
    }),
  });
});
// And when a row refers to one that doesn't exist.
app.get("/dangling/:constraint", async (request) => {
  const { constraint } = request.params as { constraint: string };
  throw new Error("Failed query: insert into …", {
    cause: Object.assign(new Error("violates foreign key constraint"), {
      code: "23503",
      constraint,
    }),
  });
});
app.get("/broken", async () => {
  throw new Error("something unexpected");
});
afterAll(() => app.close());

const post = (payload: object, url = "/things") =>
  app.inject({ method: "POST", url, payload });

describe("invalid input: 400, with a code per field", () => {
  it.each([
    [{}, { name: "required", count: "required" }],
    [{ name: "  ", count: 1 }, { name: "required" }],
    [{ name: "too long", count: 1 }, { name: "too_long" }],
    [{ name: "ok", count: -1 }, { count: "too_small" }],
    [{ name: "ok", count: 11 }, { count: "too_big" }],
    [{ name: "ok", count: "three" }, { count: "invalid" }],
    [{ name: "ok", count: 1.5 }, { count: "invalid" }],
    [
      { name: "ok", count: 1, extra: 1, more: 2 },
      { extra: "unknown_field", more: "unknown_field" },
    ],
    [{ name: "ok", count: 1, code: "bad" }, { code: "invalid_tax_id" }],
  ])("%j → %j", async (payload, fields) => {
    const response = await post(payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_input", fields });
  });

  it("names a field inside a list by its path: lines.1.quantity", async () => {
    const response = await post({
      name: "ok",
      count: 1,
      lines: [{ quantity: 1 }, { quantity: 0 }, {}],
    });
    expect(response.json()).toEqual({
      error: "invalid_input",
      fields: {
        "lines.1.quantity": "too_small",
        "lines.2.quantity": "required",
      },
    });
  });

  it("names a query parameter the same way", async () => {
    const response = await post({ name: "ok", count: 1 }, "/things?page=0");
    expect(response.json()).toEqual({
      error: "invalid_input",
      fields: { page: "too_small" },
    });
  });

  it("a body that isn't JSON at all: 400 invalid_input, with no fields to name", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/things",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_input" });
  });
});

describe("other refusals", () => {
  it("an HttpError answers its status and code", async () => {
    const response = await app.inject({ method: "GET", url: "/missing" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
  });

  it("a duplicate Postgres refuses: 409 conflict, naming the field the index guards", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/duplicate/suppliers_tax_id_unique",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "conflict",
      fields: { taxId: "taken" },
    });
  });

  it("a duplicate on an index no field is known for: still 409, without fields", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/duplicate/some_other_unique",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "conflict" });
  });

  it("a reference to a row that doesn't exist: 400, naming the field with not_found", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/dangling/supplier_products_product_id_products_id_fk",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_input",
      fields: { productId: "not_found" },
    });
  });

  it("anything unexpected is still a 500, as before: a bug, for Sentry and the logs", async () => {
    const response = await app.inject({ method: "GET", url: "/broken" });
    expect(response.statusCode).toBe(500);
  });
});
