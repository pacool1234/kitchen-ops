import {
  checkConversions,
  checkSpanishTaxId,
  NewProduct,
  NewStoreroom,
  NewSupplier,
  PackQuantity,
} from "@kitchen-ops/shared";
import { describe, expect, it } from "vitest";
import { packBaseUnits } from "../catalogue/conversions";
import {
  seedProducts,
  seedStorerooms,
  seedSupplierProducts,
  seedSuppliers,
} from "./seed-catalogue";

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

  it("about 40 products the API would take, each in one of the storerooms, one of them inactive", () => {
    expect(seedProducts.length).toBeGreaterThanOrEqual(35);
    const storerooms = seedStorerooms.map((s) => s.name);
    for (const { storeroom, active, ...product } of seedProducts) {
      expect(NewProduct.parse(product), product.name).toEqual(product);
      expect(
        checkConversions(product.baseUnit, product.conversions),
        product.name,
      ).toEqual({});
      expect(storerooms, product.name).toContain(storeroom);
      expect([undefined, false], product.name).toContain(active);
    }
    expect(seedProducts.filter((p) => p.active === false)).toHaveLength(1);
    const names = seedProducts.map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("supplier products of the seeded suppliers and products, each pack a whole number of base units", () => {
    for (const offer of seedSupplierProducts) {
      const label = `${offer.supplierTaxId} ${offer.code}`;
      expect(
        seedSuppliers.map((s) => s.taxId),
        label,
      ).toContain(offer.supplierTaxId);
      const product = seedProducts.find((p) => p.name === offer.product);
      expect(product, label).toBeDefined();
      expect(PackQuantity.parse(offer.pack.quantity), label).toBe(
        offer.pack.quantity,
      );
      expect(
        packBaseUnits({ id: "seed", ...product! }, offer.pack),
        label,
      ).toEqual({ baseUnits: expect.any(Number) });
    }
    const codes = seedSupplierProducts.map(
      (o) => `${o.supplierTaxId} ${o.code}`,
    );
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("some products come from two suppliers, in different packs", () => {
    const suppliersOf = (name: string) =>
      new Set(
        seedSupplierProducts
          .filter((o) => o.product === name)
          .map((o) => o.supplierTaxId),
      );
    expect(
      seedProducts.filter((p) => suppliersOf(p.name).size > 1).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
