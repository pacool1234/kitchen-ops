import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FIELD_ERROR_CODES, fieldError, fieldErrors } from "./errors";
import { NewSupplier } from "./suppliers";

// Zod's issues as field codes (#89): the one mapping the API answers with and the web app's forms
// check with, so a form shows the same message before sending as the API would after.

const codesOf = (schema: z.ZodType, input: unknown) =>
  fieldErrors(schema.safeParse(input).error?.issues ?? [], input);

describe("fieldErrors", () => {
  const schema = z.strictObject({
    name: z.string().trim().min(1).max(5),
    code: z.string().min(3).optional(),
    count: z.number().int().min(0).max(10),
    kind: z.enum(["a", "b"]),
    lines: z.array(z.object({ quantity: z.number().positive() })).optional(),
    taxId: z
      .string()
      .refine((t) => t === "ok", fieldError("invalid_tax_id"))
      .optional(),
  });

  it.each([
    [{}, { name: "required", count: "required", kind: "required" }],
    [{ name: "  ", count: 1, kind: "a" }, { name: "required" }],
    [{ name: "ok", code: "x", count: 1, kind: "a" }, { code: "too_short" }],
    [{ name: "too long", count: 1, kind: "a" }, { name: "too_long" }],
    [{ name: "ok", count: -1, kind: "a" }, { count: "too_small" }],
    [{ name: "ok", count: 11, kind: "a" }, { count: "too_big" }],
    [
      { name: "ok", count: "3", kind: "c" },
      { count: "invalid", kind: "invalid" },
    ],
    [{ name: "ok", count: 1, kind: "a", extra: 1 }, { extra: "unknown_field" }],
    [
      { name: "ok", count: 1, kind: "a", taxId: "no" },
      { taxId: "invalid_tax_id" },
    ],
  ])("%j → %j", (input, expected) => {
    expect(codesOf(schema, input)).toEqual(expected);
  });

  it("names a field in a list by its path, and a missing one there is required", () => {
    expect(
      codesOf(schema, {
        name: "ok",
        count: 1,
        kind: "a",
        lines: [{ quantity: 1 }, { quantity: 0 }, {}],
      }),
    ).toEqual({
      "lines.1.quantity": "too_small",
      "lines.2.quantity": "required",
    });
  });

  it("the first issue on a field wins", () => {
    const twice = z.object({
      name: z
        .string()
        .min(3)
        .regex(/^[a-z]+$/),
    });
    expect(codesOf(twice, { name: "A" })).toEqual({ name: "too_short" });
  });

  it("a supplier's form, as the web app checks it", () => {
    expect(
      codesOf(NewSupplier, { name: "", taxId: "B00123456", email: "x" }),
    ).toEqual({ name: "required", taxId: "invalid_tax_id", email: "invalid" });
  });

  it("every code it gives is one of FIELD_ERROR_CODES", () => {
    const given = Object.values(
      codesOf(schema, { name: 1, count: "x", kind: 2, extra: 1, taxId: "no" }),
    );
    for (const code of given) expect(FIELD_ERROR_CODES).toContain(code);
  });
});
