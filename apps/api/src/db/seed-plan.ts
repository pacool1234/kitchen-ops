import type { Role } from "@kitchen-ops/shared";

// What the seed may do where (#100, decision 0028). Two modes:
// - local: anywhere but production, with local-only logins whose passwords are in the README;
// - demo: only with SEED_DEMO=true, set on staging alone, one login per role whose password
//   comes from the environment (entered in Render's dashboard, never in the repo).
// Production has no SEED_DEMO, so it's never seeded.

export interface SeedUser {
  email: string;
  name: string;
  role: Role;
  password: string;
}

export interface SeedPlan {
  mode: "local" | "demo";
  users: SeedUser[];
}

/** Why the seed won't run here: the message says what to set. */
export class SeedRefused extends Error {}

/** Staging is on a public URL: a demo password is at least this long. */
export const DEMO_PASSWORD_MIN = 12;

// Local-only logins, documented in the README. Obviously fake: never reuse them anywhere real.
// The owner starts without 2FA; the first sign-in has to set it up.
const LOCAL_USERS: SeedUser[] = [
  ["counter", "counter", "local-only-counter"], // gitleaks:allow
  ["office", "office", "local-only-office"], // gitleaks:allow
  ["owner", "owner", "local-only-owner"], // gitleaks:allow
  // A second counter, for trying what changes a user's own settings without changing the
  // others': the browser tests switch its language.
  ["staff", "counter", "local-only-staff"], // gitleaks:allow
  // A second owner, so a browser test can see an owner's view of documents (#106): it sets up
  // this one's 2FA, leaving the first owner's to the 2FA test.
  ["manager", "owner", "local-only-manager"], // gitleaks:allow
  // A third owner, for the browser test that reverses a posted document (#119): it sets up this
  // one's 2FA too.
  ["director", "owner", "local-only-director"], // gitleaks:allow
  // A fourth owner, for the browser test that reverses waste (#151): it sets up its 2FA too.
  ["keeper", "owner", "local-only-keeper"], // gitleaks:allow
].map(([name, role, password]) => ({
  email: `${name}@example.test`,
  name: `Local ${name}`,
  role: role as Role,
  password: password!,
}));

const DEMO_ROLES: { role: Role; variable: string }[] = [
  { role: "counter", variable: "DEMO_PASSWORD_COUNTER" },
  { role: "office", variable: "DEMO_PASSWORD_OFFICE" },
  { role: "owner", variable: "DEMO_PASSWORD_OWNER" },
];

/** The seed's mode and its logins for this environment, or SeedRefused saying why not. */
export function planSeed(env: Record<string, string | undefined>): SeedPlan {
  if (env.SEED_DEMO === "true") {
    return {
      mode: "demo",
      users: DEMO_ROLES.map(({ role, variable }) => {
        const password = env[variable] ?? "";
        if (password.length < DEMO_PASSWORD_MIN) {
          throw new SeedRefused(
            `Refusing to seed the demo: set ${variable} to a password of at least ${DEMO_PASSWORD_MIN} characters.`,
          );
        }
        return {
          email: `${role}@example.test`,
          name: `Demo ${role}`,
          role,
          password,
        };
      }),
    };
  }
  if (env.NODE_ENV === "production") {
    throw new SeedRefused(
      "Refusing to seed: NODE_ENV is production. Staging's demo needs SEED_DEMO=true.",
    );
  }
  return { mode: "local", users: LOCAL_USERS };
}
