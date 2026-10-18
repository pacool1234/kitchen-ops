import { MeResponse } from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createDb } from "../db/client";
import { users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { testConfig } from "../test/helpers";
import { createAuth } from "./auth";

const config = testConfig();
const ORIGIN = config.BETTER_AUTH_URL;
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, verifications cascade`);
});

function getMe(cookie: string) {
  return app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
}

function patchMe(cookie: string | undefined, payload: object) {
  return app.inject({
    method: "PATCH",
    url: "/api/me",
    headers: cookie ? { cookie } : {},
    payload,
  });
}

describe("each user's language (#86)", () => {
  it("is Spanish until the user chooses another", async () => {
    const cookie = await signedInAs(app, auth, "counter");
    const me = MeResponse.parse((await getMe(cookie)).json());
    expect(me.locale).toBe("es");
  });

  it("PATCH /api/me saves it, and every later /api/me returns it", async () => {
    const cookie = await signedInAs(app, auth, "office");

    const changed = await patchMe(cookie, { locale: "en" });
    expect(changed.statusCode).toBe(200);
    expect(MeResponse.parse(changed.json())).toMatchObject({
      role: "office",
      locale: "en",
    });

    expect(MeResponse.parse((await getMe(cookie)).json()).locale).toBe("en");
  });

  it("refuses a language the app doesn't have: 400", async () => {
    const cookie = await signedInAs(app, auth, "counter");
    const response = await patchMe(cookie, { locale: "fr" });
    expect(response.statusCode).toBe(400);
    expect(MeResponse.parse((await getMe(cookie)).json()).locale).toBe("es");
  });

  it("needs a session: 401", async () => {
    const response = await patchMe(undefined, { locale: "en" });
    expect(response.statusCode).toBe(401);
  });

  it("changes nothing else: a role sent along is refused, and stays as it was", async () => {
    const cookie = await signedInAs(app, auth, "counter");
    const response = await patchMe(cookie, { locale: "en", role: "owner" });
    expect(response.statusCode).toBe(400);
    expect(MeResponse.parse((await getMe(cookie)).json()).role).toBe(
      "counter",
    );
  });

  it("can't be changed through Better Auth's own update-user", async () => {
    const cookie = await signedInAs(app, auth, "counter");
    await app.inject({
      method: "POST",
      url: "/api/auth/update-user",
      headers: { cookie, origin: ORIGIN },
      payload: { locale: "en" },
    });
    expect(MeResponse.parse((await getMe(cookie)).json()).locale).toBe("es");
  });
});
