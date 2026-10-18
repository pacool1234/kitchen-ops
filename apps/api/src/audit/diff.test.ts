import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { diffChanges, REDACTED } from "./diff";

describe("diffChanges: what an audit entry says changed (#87)", () => {
  it("keeps only the fields that changed, each with its value before and after", () => {
    expect(
      diffChanges(
        { name: "Tomate", baseUnit: "g", active: true },
        { name: "Tomate pera", baseUnit: "g", active: true },
      ),
    ).toEqual({ name: { before: "Tomate", after: "Tomate pera" } });
  });

  it("a creation has every field, from null; a deletion every field, to null", () => {
    expect(diffChanges(null, { name: "Tomate", baseUnit: "g" })).toEqual({
      name: { before: null, after: "Tomate" },
      baseUnit: { before: null, after: "g" },
    });
    expect(diffChanges({ name: "Tomate" }, null)).toEqual({
      name: { before: "Tomate", after: null },
    });
  });

  it("nothing changed: no fields", () => {
    expect(diffChanges({ locale: "es" }, { locale: "es" })).toEqual({});
  });

  it("compares lists and objects by what's in them, not by identity", () => {
    expect(diffChanges({ tags: ["a", "b"] }, { tags: ["a", "b"] })).toEqual({});
    expect(diffChanges({ unit: { g: 1000 } }, { unit: { g: 1000 } })).toEqual(
      {},
    );
    expect(diffChanges({ tags: ["a"] }, { tags: ["a", "b"] })).toEqual({
      tags: { before: ["a"], after: ["a", "b"] },
    });
  });

  it("stores amounts and dates as JSON can: a bigint as its digits, a date as ISO text", () => {
    expect(
      diffChanges(
        { totalCents: 1250n, at: new Date("2026-10-18T10:00:00Z") },
        {
          totalCents: 99999999999999999999n,
          at: new Date("2026-10-19T10:00:00Z"),
        },
      ),
    ).toEqual({
      totalCents: { before: "1250", after: "99999999999999999999" },
      at: {
        before: "2026-10-18T10:00:00.000Z",
        after: "2026-10-19T10:00:00.000Z",
      },
    });
  });

  it("never keeps a password, secret, token or session: it says it changed, not to what", () => {
    expect(
      diffChanges(
        { password: "old-one", apiKey: "k1", sessionToken: "s1" },
        { password: "new-one", apiKey: "k2", sessionToken: "s2" },
      ),
    ).toEqual({
      password: { before: REDACTED, after: REDACTED },
      apiKey: { before: REDACTED, after: REDACTED },
      sessionToken: { before: REDACTED, after: REDACTED },
    });
    // A field set for the first time: there was nothing before, and that's not a secret.
    expect(diffChanges(null, { twoFactorSecret: "s" })).toEqual({
      twoFactorSecret: { before: null, after: REDACTED },
    });
  });

  const field = fc.constantFrom("name", "baseUnit", "active", "price", "notes");
  const record = fc.dictionary(field, fc.jsonValue(), { maxKeys: 5 });

  it("any two records: exactly the fields whose values differ, with those values", () => {
    fc.assert(
      fc.property(record, record, (before, after) => {
        const diff = diffChanges(before, after);
        const same = (a: unknown, b: unknown) =>
          JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
        for (const key of new Set([
          ...Object.keys(before),
          ...Object.keys(after),
        ])) {
          if (same(before[key], after[key])) {
            expect(diff).not.toHaveProperty(key);
          } else {
            expect(diff[key]).toEqual({
              before: before[key] ?? null,
              after: after[key] ?? null,
            });
          }
        }
      }),
    );
  });

  it("any secret: its value is never in the entry", () => {
    const sensitive = fc.constantFrom(
      "password",
      "secret",
      "token",
      "refreshToken",
      "sessionId",
      "api_key",
    );
    fc.assert(
      fc.property(sensitive, fc.uuid(), fc.uuid(), (key, a, b) => {
        const diff = diffChanges({ [key]: `old-${a}` }, { [key]: `new-${b}` });
        const stored = JSON.stringify(diff);
        expect(stored).not.toContain(a);
        expect(stored).not.toContain(b);
      }),
    );
  });
});
