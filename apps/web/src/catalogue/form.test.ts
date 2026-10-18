import {
  checkConversions,
  NewProduct,
  NewStoreroom,
  NewSupplier,
} from "@kitchen-ops/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { apiFieldErrors, checkFields, isDirty } from "./form";
import { amountToFactor } from "./units";

// A catalogue form's checks (#89): the shared schema's own, so the form refuses what the API
// would, and the API's answers land on the same fields.

describe("checkFields", () => {
  it("valid: the schema's output, and no errors", () => {
    expect(
      checkFields(NewSupplier, {
        name: " Huerto ",
        taxId: "b-00.123.455",
        contactName: "",
        email: "",
        phone: "",
      }),
    ).toEqual({
      data: {
        name: "Huerto",
        taxId: "B00123455",
        contactName: null,
        email: null,
        phone: null,
      },
      errors: {},
    });
  });

  it("invalid: no output, and a code for each refused field", () => {
    expect(checkFields(NewStoreroom, { name: "", type: "" })).toEqual({
      errors: { name: "required", type: "invalid" },
    });
  });
});

describe("checkFields, when the form's values aren't the API's body", () => {
  // A product's form holds each conversion's size as typed, in kilos; the API takes base units.
  interface Values {
    name: string;
    rows: { unit: string; amount: string }[];
  }
  const toBody = (v: Values) => ({
    name: v.name,
    baseUnit: "g",
    category: "produce",
    conversions: v.rows.map((r) => ({
      unit: r.unit,
      factor: amountToFactor(r.amount),
    })),
  });
  const check = (body: ReturnType<typeof toBody>) =>
    checkConversions(
      "g",
      body.conversions.map((c) => ({ unit: c.unit, factor: c.factor ?? 0 })),
    );

  it("checks the body made from the values, and names errors by the API's paths", () => {
    expect(
      checkFields(
        NewProduct,
        {
          name: "Tomate",
          rows: [
            { unit: "caja", amount: "6" },
            { unit: "kg", amount: "" },
          ],
        },
        { toBody },
      ),
    ).toEqual({ errors: { "conversions.1.factor": "required" } });
  });

  it("valid: the body, ready to send", () => {
    expect(
      checkFields(
        NewProduct,
        { name: "Tomate", rows: [{ unit: "caja", amount: "6" }] },
        { toBody },
      ).data,
    ).toEqual({
      name: "Tomate",
      baseUnit: "g",
      category: "produce",
      conversions: [{ unit: "caja", factor: 6000 }],
    });
  });

  it("adds the checks a schema can't make alone, such as a unit named after the base unit", () => {
    expect(
      checkFields(
        NewProduct,
        { name: "Tomate", rows: [{ unit: "G", amount: "1" }] },
        { toBody, check },
      ),
    ).toEqual({ errors: { "conversions.0.unit": "reserved" } });
  });
});

describe("isDirty: whether the form differs from what was loaded", () => {
  const loaded = { name: "Huerto", taxId: "B00123455", email: "" };

  it("the same values, in any order, aren't a change", () => {
    expect(
      isDirty({ email: "", taxId: "B00123455", name: "Huerto" }, loaded),
    ).toBe(false);
  });

  it("any field changed is", () => {
    expect(isDirty({ ...loaded, email: "a@b.example" }, loaded)).toBe(true);
    expect(isDirty({ ...loaded, name: "Huerto " }, loaded)).toBe(true);
  });
});

describe("apiFieldErrors: what the API refused, by field", () => {
  it("a 400 or 409 with fields gives them", () => {
    expect(
      apiFieldErrors(new ApiError(409, "conflict", { taxId: "taken" })),
    ).toEqual({ taxId: "taken" });
  });

  it("an answer without fields, or another error, gives none", () => {
    expect(apiFieldErrors(new ApiError(403, "forbidden"))).toBeUndefined();
    expect(apiFieldErrors(new Error("offline"))).toBeUndefined();
  });
});
