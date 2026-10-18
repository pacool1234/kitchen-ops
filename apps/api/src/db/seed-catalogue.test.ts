import {
  checkSpanishTaxId,
  NewStoreroom,
  NewSupplier,
} from "@kitchen-ops/shared";
import { describe, expect, it } from "vitest";
import { seedStorerooms, seedSuppliers } from "./seed-catalogue";

// The seed writes straight to the database, past the API's checks: these hold it to them.

describe("the seeded catalogue (#88)", () => {
  it("three storerooms, one of each type, each one the API would take", () => {
    expect(seedStorerooms.map((s) => s.type).sort()).toEqual([
      "bar",
      "cold_room",
      "dry_store",
    ]);
    for (const storeroom of seedStorerooms) {
      expect(NewStoreroom.parse(storeroom)).toEqual(storeroom);
    }
  });

  it("suppliers the API would take as they are, with different tax IDs", () => {
    for (const supplier of seedSuppliers) {
      expect(NewSupplier.parse(supplier), supplier.name).toMatchObject(
        supplier,
      );
    }
    const taxIds = seedSuppliers.map((s) => s.taxId);
    expect(new Set(taxIds).size).toBe(taxIds.length);
  });

  it("every tax ID is a valid CIF in province 00, which belongs to no real company", () => {
    for (const { taxId } of seedSuppliers) {
      expect(checkSpanishTaxId(taxId), taxId).toEqual({
        valid: true,
        kind: "CIF",
      });
      expect(taxId.slice(1, 3), taxId).toBe("00");
    }
  });
});
