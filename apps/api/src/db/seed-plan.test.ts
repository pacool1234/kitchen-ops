import { describe, expect, it } from "vitest";
import { DEMO_PASSWORD_MIN, planSeed, SeedRefused } from "./seed-plan";

// What the seed may do where (#100): local-only logins anywhere but production, and staging's
// demo, only when it's asked for in so many words, with passwords of its own.

const passwords = {
  DEMO_PASSWORD_COUNTER: "c".repeat(DEMO_PASSWORD_MIN),
  DEMO_PASSWORD_OFFICE: "o".repeat(DEMO_PASSWORD_MIN),
  DEMO_PASSWORD_OWNER: "w".repeat(DEMO_PASSWORD_MIN),
};
const logins = (plan: ReturnType<typeof planSeed>) =>
  plan.users.map((u) => [u.email, u.role, u.password]);

describe("planSeed", () => {
  it("in production without SEED_DEMO: refused", () => {
    expect(() => planSeed({ NODE_ENV: "production" })).toThrow(SeedRefused);
    expect(() => planSeed({ NODE_ENV: "production" })).toThrow(
      /NODE_ENV is production/,
    );
  });

  it("anywhere else without SEED_DEMO: the six local-only logins", () => {
    for (const NODE_ENV of [undefined, "development", "test"]) {
      const plan = planSeed({ NODE_ENV });
      expect(plan.mode).toBe("local");
      expect(logins(plan)).toEqual([
        ["counter@example.test", "counter", "local-only-counter"],
        ["office@example.test", "office", "local-only-office"],
        ["owner@example.test", "owner", "local-only-owner"],
        ["staff@example.test", "counter", "local-only-staff"],
        ["manager@example.test", "owner", "local-only-manager"],
        ["director@example.test", "owner", "local-only-director"],
      ]);
    }
  });

  it("with SEED_DEMO=true, in production too: one login per role, with the passwords it's given", () => {
    const plan = planSeed({
      NODE_ENV: "production",
      SEED_DEMO: "true",
      ...passwords,
    });
    expect(plan.mode).toBe("demo");
    expect(logins(plan)).toEqual([
      ["counter@example.test", "counter", passwords.DEMO_PASSWORD_COUNTER],
      ["office@example.test", "office", passwords.DEMO_PASSWORD_OFFICE],
      ["owner@example.test", "owner", passwords.DEMO_PASSWORD_OWNER],
    ]);
    // Never a local-only password.
    expect(plan.users.some((u) => u.password.startsWith("local-only"))).toBe(
      false,
    );
  });

  it.each([
    "DEMO_PASSWORD_COUNTER",
    "DEMO_PASSWORD_OFFICE",
    "DEMO_PASSWORD_OWNER",
  ])("with SEED_DEMO=true but no %s: refused, naming it", (name) => {
    const env = {
      NODE_ENV: "production",
      SEED_DEMO: "true",
      ...passwords,
      [name]: "",
    };
    expect(() => planSeed(env)).toThrow(SeedRefused);
    expect(() => planSeed(env)).toThrow(name);
  });

  it(`a demo password shorter than ${DEMO_PASSWORD_MIN} characters: refused`, () => {
    const env = {
      SEED_DEMO: "true",
      ...passwords,
      DEMO_PASSWORD_OFFICE: "o".repeat(DEMO_PASSWORD_MIN - 1),
    };
    expect(() => planSeed(env)).toThrow(/DEMO_PASSWORD_OFFICE.*at least 12/);
  });

  it.each(["1", "yes", "TRUE", " true", ""])(
    'SEED_DEMO="%s" isn\'t "true": as if it weren\'t set',
    (value) => {
      expect(() =>
        planSeed({ NODE_ENV: "production", SEED_DEMO: value, ...passwords }),
      ).toThrow(/NODE_ENV is production/);
      expect(planSeed({ SEED_DEMO: value, ...passwords }).mode).toBe("local");
    },
  );
});
