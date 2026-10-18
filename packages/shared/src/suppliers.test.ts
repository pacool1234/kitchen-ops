import { describe, expect, it } from "vitest";
import { NewSupplier, SupplierChanges } from "./suppliers";

// What a supplier's form sends (#88): blank contact fields mean "none", and a change sends only
// the fields it changes.

describe("NewSupplier", () => {
  it("trims each field, and a blank or missing contact field is none (null)", () => {
    expect(
      NewSupplier.parse({
        name: "  Frutas del Huerto, S.L. ",
        taxId: "b-00.123.455",
        contactName: "  ",
        email: "",
      }),
    ).toEqual({
      name: "Frutas del Huerto, S.L.",
      taxId: "B00123455",
      contactName: null,
      email: null,
    });
  });

  it("refuses an email that isn't one, a phone with letters, and fields it doesn't know", () => {
    const result = NewSupplier.safeParse({
      name: "Frutas del Huerto, S.L.",
      taxId: "B00123455",
      email: "pedidos at huerto",
      phone: "call me",
      fax: "none",
    });
    expect(result.error?.issues.map((i) => [i.code, i.path])).toEqual(
      expect.arrayContaining([
        ["invalid_format", ["email"]],
        ["invalid_format", ["phone"]],
        ["unrecognized_keys", []],
      ]),
    );
  });
});

describe("SupplierChanges", () => {
  it("holds only the fields that were sent: one not sent stays as it is", () => {
    const changes = SupplierChanges.parse({ name: "Huerto, S.L." });
    expect(Object.keys(changes)).toEqual(["name"]);
  });

  it("a contact field sent as null or blank is cleared", () => {
    expect(SupplierChanges.parse({ email: null, phone: " " })).toEqual({
      email: null,
      phone: null,
    });
  });

  it("deactivates a supplier: active false", () => {
    expect(SupplierChanges.parse({ active: false })).toEqual({ active: false });
  });
});
