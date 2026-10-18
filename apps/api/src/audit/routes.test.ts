import { randomUUIDv7 } from "node:crypto";
import { AuditLogPage } from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createUser } from "../auth/users";
import { createDb } from "../db/client";
import { auditLog, users } from "../db/schema";
import { signedInAs, signedInAsOwner, TEST_PASSWORD } from "../test/auth";
import { testConfig } from "../test/helpers";

// GET /api/audit-log (#87): the owner reads the log, filtered and a page at a time.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

let ownerCookie: string;
let counterCookie: string;
let officeCookie: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await db.execute(sql`truncate ${users}, verifications cascade`);
  ownerCookie = await signedInAsOwner(app, auth);
  counterCookie = await signedInAs(app, auth, "counter");
  officeCookie = await signedInAs(app, auth, "office");
  const all = await db.select().from(users);
  for (const user of all) ids[user.role] = user.id;
  // Someone else with an entry, to check the user filter keeps only one person's.
  const other = await createUser(auth, {
    email: "other@example.test",
    name: "Other office",
    role: "office",
    password: TEST_PASSWORD,
  });
  ids.other = other.id;

  // Five entries, a day apart, written directly: this tests reading the log.
  const entry = (
    day: number,
    who: string,
    action: "create" | "update" | "delete",
    entityType: string,
    entityId: string,
  ) => ({
    id: randomUUIDv7(),
    occurredAt: new Date(`2026-10-0${day}T10:00:00Z`),
    userId: ids[who]!,
    action,
    entityType,
    entityId,
    requestId: `request-${day}`,
    changes: { name: { before: `name-${day - 1}`, after: `name-${day}` } },
  });
  await db
    .insert(auditLog)
    .values([
      entry(1, "counter", "update", "product", "p1"),
      entry(2, "office", "update", "product", "p1"),
      entry(3, "office", "create", "product", "p2"),
      entry(4, "other", "update", "user", "u1"),
      entry(5, "owner", "delete", "product", "p2"),
    ]);
});

async function read(query = "", cookie = ownerCookie) {
  const response = await app.inject({
    method: "GET",
    url: `/api/audit-log${query}`,
    headers: { cookie },
  });
  return response;
}

/** The request IDs of a page's entries, which say which day each is: newest first. */
async function days(query = "") {
  const response = await read(query);
  expect(response.statusCode, response.body).toBe(200);
  const page = AuditLogPage.parse(response.json());
  return {
    days: page.entries.map((e) => e.requestId.replace("request-", "")),
    total: page.total,
  };
}

describe("GET /api/audit-log: the owner reads the log", () => {
  it("only the owner: 401 signed out, 403 for counter and office", async () => {
    const signedOut = await app.inject({
      method: "GET",
      url: "/api/audit-log",
    });
    expect(signedOut.statusCode).toBe(401);
    expect((await read("", counterCookie)).statusCode).toBe(403);
    expect((await read("", officeCookie)).statusCode).toBe(403);
  });

  it("newest first, with who did it, when, and what changed", async () => {
    const page = AuditLogPage.parse((await read()).json());
    expect(page.entries.map((e) => e.requestId)).toEqual([
      "request-5",
      "request-4",
      "request-3",
      "request-2",
      "request-1",
    ]);
    expect(page).toMatchObject({ total: 5, page: 1, pageSize: 50 });
    expect(page.entries[0]).toMatchObject({
      occurredAt: "2026-10-05T10:00:00.000Z",
      user: { id: ids.owner, name: "Test owner", email: "owner@example.test" },
      action: "delete",
      entityType: "product",
      entityId: "p2",
      documentId: null,
      changes: { name: { before: "name-4", after: "name-5" } },
    });
  });

  it("by entity: a type, or one entity", async () => {
    expect(await days("?entityType=product")).toEqual({
      days: ["5", "3", "2", "1"],
      total: 4,
    });
    expect(await days("?entityType=product&entityId=p1")).toEqual({
      days: ["2", "1"],
      total: 2,
    });
  });

  it("by user", async () => {
    expect(await days(`?userId=${ids.office}`)).toEqual({
      days: ["3", "2"],
      total: 2,
    });
  });

  it("by time: from a moment, included, up to another, excluded", async () => {
    expect(
      await days("?from=2026-10-02T10:00:00Z&to=2026-10-04T10:00:00Z"),
    ).toEqual({ days: ["3", "2"], total: 2 });
  });

  it("a page at a time, the total counting every matching entry", async () => {
    expect(await days("?pageSize=2&page=1")).toEqual({
      days: ["5", "4"],
      total: 5,
    });
    expect(await days("?pageSize=2&page=3")).toEqual({ days: ["1"], total: 5 });
    expect(await days("?pageSize=2&page=4")).toEqual({ days: [], total: 5 });
    expect(await days("?entityType=product&pageSize=1&page=2")).toEqual({
      days: ["3"],
      total: 4,
    });
  });

  it("refuses a query it can't read: 400", async () => {
    for (const query of [
      "?pageSize=500",
      "?page=0",
      "?userId=not-a-uuid",
      "?from=yesterday",
    ]) {
      expect((await read(query)).statusCode, query).toBe(400);
    }
  });
});
