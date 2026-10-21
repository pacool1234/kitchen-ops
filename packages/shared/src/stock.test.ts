import { describe, expect, it } from "vitest";
import { fieldErrors } from "./errors";
import { RecordCount } from "./stock";

// A count's body (#149): what was counted, where, and when. 0 is a count too, "none left".

const TOMATE = "0199a000-0000-7000-8000-000000000001";
const ACEITE = "0199a000-0000-7000-8000-000000000002";
const COLD_ROOM = "0199a000-0000-7000-8000-000000000003";

const count = (more: object = {}) => ({
  storeroomId: COLD_ROOM,
  countedAt: "2026-10-21T10:00:00+02:00",
  lines: [
    { productId: TOMATE, quantity: "7.5", unit: "kg" },
    { productId: ACEITE, quantity: "0", unit: "l" },
  ],
  ...more,
});

const refusals = (body: object) => {
  const parsed = RecordCount.safeParse(body);
  return parsed.success ? {} : fieldErrors(parsed.error.issues, body);
};

describe("RecordCount", () => {
  it("takes 0 as a count, written any way: none left", () => {
    const parsed = RecordCount.parse(
      count({
        lines: [{ productId: ACEITE, quantity: "0.000", unit: "l" }],
      }),
    );
    expect(parsed.lines).toEqual([
      { productId: ACEITE, quantity: "0", unit: "l" },
    ]);
  });

  it("keeps when it was counted as one instant in UTC: 10:00 in Madrid in October is 08:00Z", () => {
    expect(RecordCount.parse(count()).countedAt).toBe(
      "2026-10-21T08:00:00.000Z",
    );
    expect(
      RecordCount.parse(count({ countedAt: "2026-10-21T08:00:00Z" })).countedAt,
    ).toBe("2026-10-21T08:00:00.000Z");
  });

  it("refuses a time without its offset: whose 10:00 would it be?", () => {
    expect(refusals(count({ countedAt: "2026-10-21T10:00:00" }))).toEqual({
      countedAt: "invalid",
    });
    expect(refusals(count({ countedAt: "2026-10-21" }))).toEqual({
      countedAt: "invalid",
    });
  });

  it("refuses a negative quantity, and more than a pack may hold", () => {
    expect(
      refusals(
        count({ lines: [{ productId: TOMATE, quantity: "-1", unit: "kg" }] }),
      ),
    ).toEqual({ "lines.0.quantity": "invalid" });
    expect(
      refusals(
        count({
          lines: [{ productId: TOMATE, quantity: "100001", unit: "kg" }],
        }),
      ),
    ).toEqual({ "lines.0.quantity": "too_big" });
  });

  it("refuses a product counted twice, on its second line, as taken", () => {
    expect(
      refusals(
        count({
          lines: [
            { productId: TOMATE, quantity: "7.5", unit: "kg" },
            { productId: ACEITE, quantity: "1", unit: "l" },
            { productId: TOMATE, quantity: "500", unit: "g" },
          ],
        }),
      ),
    ).toEqual({ "lines.2.productId": "taken" });
  });

  it("refuses no lines, and fields it doesn't take", () => {
    expect(refusals(count({ lines: [] }))).toEqual({ lines: "too_small" });
    expect(refusals(count({ reason: "spoiled" }))).toEqual({
      reason: "unknown_field",
    });
  });
});
