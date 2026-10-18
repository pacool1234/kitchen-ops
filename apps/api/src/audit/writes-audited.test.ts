import { endpoints, MeResponse } from "@kitchen-ops/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { auditLog, users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { testConfig } from "../test/helpers";

// Every write endpoint records its changes in the audit log (#87). A new write endpoint fails
// the first test until it has a case here: the audit log can't be forgotten.

const config = testConfig();
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

const entriesFor = (entityType: string, entityId: string) =>
  db
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)),
    );

/**
 * One case per write endpoint, by its name in the contract: it makes the write, checks the
 * one entry each change records, and checks that a refused write, or one that changes
 * nothing, records none.
 */
const WRITE_CASES: Record<string, () => Promise<void>> = {
  async updateMe() {
    const cookie = await signedInAs(app, auth, "counter");
    const patch = (locale: string) =>
      app.inject({
        method: "PATCH",
        url: "/api/me",
        headers: { cookie },
        payload: { locale },
      });
    const me = MeResponse.parse(
      (
        await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })
      ).json(),
    );

    const changed = await patch("en");
    expect(changed.statusCode).toBe(200);
    expect(await entriesFor("user", me.id)).toEqual([
      expect.objectContaining({
        userId: me.id,
        action: "update",
        requestId: changed.headers["x-request-id"],
        documentId: null,
        changes: { locale: { before: "es", after: "en" } },
      }),
    ]);

    // The same language again changes nothing, so it records nothing.
    expect((await patch("en")).statusCode).toBe(200);
    // Refused: nothing written, nothing recorded.
    expect((await patch("fr")).statusCode).toBe(400);
    expect(await entriesFor("user", me.id)).toHaveLength(1);
  },
};

describe("every write is in the audit log (#87)", () => {
  it("every write endpoint in the contract has an audit case here", () => {
    const writes = Object.entries(endpoints)
      .filter(([, endpoint]) => endpoint.method !== "GET")
      .map(([name]) => name)
      .sort();
    expect(
      Object.keys(WRITE_CASES).sort(),
      "each write endpoint needs a case in WRITE_CASES",
    ).toEqual(writes);
  });

  for (const [name, check] of Object.entries(WRITE_CASES)) {
    it(
      `${name}: one entry per change; none for a refused write or one that changes nothing`,
      check,
    );
  }
});
