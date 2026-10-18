import { describe, expect, it } from "vitest";
import { deviceLocale, localeAfterSignIn } from "./locale";

describe("which language the app shows (#86)", () => {
  it("before sign-in: the one last used on this device", () => {
    expect(deviceLocale("en")).toBe("en");
    expect(deviceLocale("es")).toBe("es");
  });

  it("before sign-in, on a new device or with anything else stored: Spanish", () => {
    expect(deviceLocale(null)).toBe("es");
    expect(deviceLocale("fr")).toBe("es");
    expect(deviceLocale("")).toBe("es");
  });

  it("after sign-in: the user's own saved language, whatever the device last showed", () => {
    // A shared kitchen tablet: the previous user's language doesn't carry over.
    expect(localeAfterSignIn("es", null)).toEqual({ show: "es", save: false });
    expect(localeAfterSignIn("en", null)).toEqual({ show: "en", save: false });
  });

  it("unless they chose one on the sign-in page just now: it's shown, and saved as theirs", () => {
    expect(localeAfterSignIn("es", "en")).toEqual({ show: "en", save: true });
    expect(localeAfterSignIn("en", "en")).toEqual({ show: "en", save: false });
  });
});
