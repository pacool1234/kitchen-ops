import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { errorMessageKey } from "./errors";

describe("errorMessageKey: what to tell the user about a failed call (#86)", () => {
  it("an API error code becomes its message", () => {
    expect(errorMessageKey(new ApiError(403, "forbidden"))).toBe(
      "errors.forbidden",
    );
    expect(errorMessageKey(new ApiError(403, "two_factor_required"))).toBe(
      "errors.two_factor_required",
    );
    expect(errorMessageKey(new ApiError(200, "unexpected_response"))).toBe(
      "errors.unexpected_response",
    );
  });

  it("a code the app has no message for, or any other error, gets the general one", () => {
    expect(errorMessageKey(new ApiError(500, "Internal Server Error"))).toBe(
      "errors.unknown",
    );
    // Not a key of errors, though it is a property of every object.
    expect(errorMessageKey(new ApiError(400, "toString"))).toBe(
      "errors.unknown",
    );
    expect(errorMessageKey(new TypeError("Failed to fetch"))).toBe(
      "errors.unknown",
    );
  });
});
