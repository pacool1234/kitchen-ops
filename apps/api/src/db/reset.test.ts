import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resettableDatabase } from "./reset";

const url = (name: string) =>
  `postgres://kitchen_ops:kitchen_ops@127.0.0.1:5432/${name}`;

describe("resettableDatabase: db:reset only ever drops a browser-test database", () => {
  it("a database whose name ends in _e2e can be reset, outside production", () => {
    expect(resettableDatabase(url("kitchen_ops_e2e"), "test")).toBe(
      "kitchen_ops_e2e",
    );
    expect(resettableDatabase(url("kitchen_ops_e2e"), undefined)).toBe(
      "kitchen_ops_e2e",
    );
  });

  it("refuses the development and API test databases, naming the rule", () => {
    for (const name of ["kitchen_ops", "kitchen_ops_test", "e2e_kitchen_ops"]) {
      expect(() => resettableDatabase(url(name), "test")).toThrow(
        "only a database whose name ends in _e2e",
      );
    }
  });

  it("refuses in production, whatever the name", () => {
    expect(() =>
      resettableDatabase(url("kitchen_ops_e2e"), "production"),
    ).toThrow("never in production");
  });

  it("any name: reset is allowed exactly when it ends in _e2e and NODE_ENV isn't production", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z_]{1,20}$/),
        fc.constantFrom(undefined, "development", "test", "production"),
        (name, nodeEnv) => {
          const allowed = name.endsWith("_e2e") && nodeEnv !== "production";
          const attempt = () => resettableDatabase(url(name), nodeEnv);
          if (allowed) expect(attempt()).toBe(name);
          else expect(attempt).toThrow();
        },
      ),
    );
  });
});
