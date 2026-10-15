import type { Role } from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createDb } from "../db/client";
import { users } from "../db/schema";
import { testConfig, totpCode } from "../test/helpers";
import { createAuth } from "./auth";
import { createUser } from "./users";

const config = testConfig();
const ORIGIN = config.BETTER_AUTH_URL;
const PASSWORD = "test-only-password";
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
afterAll(close);

const app = buildApp(config);
// A route only office and owner may use, to test the role check on its own.
app.get(
  "/test/office-only",
  { config: { roles: ["office", "owner"] } },
  async () => ({ ok: true }),
);
afterAll(() => app.close());

beforeEach(async () => {
  // Sessions, accounts and 2FA rows go with their user (on delete cascade).
  await db.execute(sql`truncate ${users}, verifications cascade`);
});

async function userWithRole(role: Role) {
  return createUser(auth, {
    email: `${role}@example.test`,
    name: `Test ${role}`,
    role,
    password: PASSWORD,
  });
}

function cookieHeader(response: {
  cookies: { name: string; value: string }[];
}) {
  return response.cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function signIn(email: string, password = PASSWORD) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: ORIGIN },
    payload: { email, password },
  });
}

function get(url: string, cookie?: string) {
  return app.inject({
    method: "GET",
    url,
    headers: cookie ? { cookie } : {},
  });
}

function post(url: string, cookie: string, payload: object) {
  return app.inject({
    method: "POST",
    url,
    headers: { cookie, origin: ORIGIN },
    payload,
  });
}

/** Turns on TOTP for a signed-in user, as the authenticator-app setup would. Returns the secret. */
async function enableTotp(cookie: string) {
  const enabled = await post("/api/auth/two-factor/enable", cookie, {
    password: PASSWORD,
  });
  expect(enabled.statusCode).toBe(200);
  const secret = new URL(
    enabled.json<{ totpURI: string }>().totpURI,
  ).searchParams.get("secret");
  if (!secret) throw new Error("no secret in totpURI");

  const verified = await post("/api/auth/two-factor/verify-totp", cookie, {
    code: totpCode(secret),
  });
  expect(verified.statusCode).toBe(200);
  return { secret, cookie: cookieHeader(verified) || cookie };
}

describe("routes are locked by default", () => {
  it("unauthenticated request → 401", async () => {
    const response = await get("/api/me");
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("a made-up session cookie → 401", async () => {
    const response = await get(
      "/api/me",
      "better-auth.session_token=not-a-real-token",
    );
    expect(response.statusCode).toBe(401);
  });

  it("GET /health stays public", async () => {
    expect((await get("/health")).statusCode).toBe(200);
  });

  it("a wrong password does not sign in", async () => {
    await userWithRole("counter");
    const response = await signIn("counter@example.test", "wrong-password");
    expect(response.statusCode).toBe(401);
    expect(response.cookies).toHaveLength(0);
  });
});

describe("roles per route", () => {
  it("wrong role → 403", async () => {
    await userWithRole("counter");
    const cookie = cookieHeader(await signIn("counter@example.test"));

    const response = await get("/test/office-only", cookie);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "forbidden" });
  });

  it("right role → 200", async () => {
    await userWithRole("office");
    const cookie = cookieHeader(await signIn("office@example.test"));

    const response = await get("/test/office-only", cookie);
    expect(response.statusCode).toBe(200);
  });

  it.each(["counter", "office"] as const)(
    "GET /api/me returns the signed-in %s",
    async (role) => {
      const user = await userWithRole(role);
      const cookie = cookieHeader(await signIn(`${role}@example.test`));

      const response = await get("/api/me", cookie);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: user.id,
        email: `${role}@example.test`,
        name: `Test ${role}`,
        role,
      });
    },
  );

  it("user IDs are UUID v7 created by the API (decision 0011)", async () => {
    const user = await userWithRole("counter");
    expect(user.id).toMatch(UUID_V7);
  });
});

describe("owners must use 2FA (TOTP)", () => {
  it("an owner without 2FA can only set it up: 403 two_factor_required", async () => {
    await userWithRole("owner");
    const cookie = cookieHeader(await signIn("owner@example.test"));

    const response = await get("/api/me", cookie);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "two_factor_required" });
  });

  it("after setting up TOTP, the owner gets in, including office-only routes", async () => {
    await userWithRole("owner");
    const { cookie } = await enableTotp(
      cookieHeader(await signIn("owner@example.test")),
    );

    expect((await get("/api/me", cookie)).json()).toMatchObject({
      role: "owner",
    });
    expect((await get("/test/office-only", cookie)).statusCode).toBe(200);
  });

  it("every later sign-in asks for a TOTP code before giving a session", async () => {
    await userWithRole("owner");
    const { secret } = await enableTotp(
      cookieHeader(await signIn("owner@example.test")),
    );

    const password = await signIn("owner@example.test");
    expect(password.statusCode).toBe(200);
    expect(password.json()).toMatchObject({ twoFactorRedirect: true });
    const pending = cookieHeader(password);
    // The password alone is not a session.
    expect((await get("/api/me", pending)).statusCode).toBe(401);

    // Code from the next 30-second step: the current one was used during setup.
    const verified = await post("/api/auth/two-factor/verify-totp", pending, {
      code: totpCode(secret, Date.now() + 30_000),
    });
    expect(verified.statusCode).toBe(200);
    const response = await get("/api/me", cookieHeader(verified));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ role: "owner" });
  });

  it("a wrong TOTP code does not give a session", async () => {
    await userWithRole("owner");
    await enableTotp(cookieHeader(await signIn("owner@example.test")));

    const pending = cookieHeader(await signIn("owner@example.test"));
    const verified = await post("/api/auth/two-factor/verify-totp", pending, {
      code: "000000",
    });
    expect(verified.statusCode).toBe(401);
  });
});

describe("accounts are created by the server only", () => {
  it("public sign-up is disabled", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: ORIGIN },
      payload: {
        email: "stranger@example.test",
        password: PASSWORD,
        name: "Stranger",
      },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(0);
  });

  it("a user cannot change their own role", async () => {
    await userWithRole("counter");
    const cookie = cookieHeader(await signIn("counter@example.test"));

    await post("/api/auth/update-user", cookie, { role: "owner" });

    expect((await get("/api/me", cookie)).json()).toMatchObject({
      role: "counter",
    });
  });
});
