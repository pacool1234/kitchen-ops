import { randomUUIDv7 } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../auth/auth";
import { createUser } from "../auth/users";
import { createDb } from "../db/client";
import { auditLog, users } from "../db/schema";
import { TEST_PASSWORD } from "../test/auth";
import { testConfig } from "../test/helpers";
import { audited, type AuditContext } from "./audited";
import { REDACTED } from "./diff";

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
afterAll(close);

let userId: string;
beforeEach(async () => {
  // The audit log goes with the users it refers to (truncate … cascade).
  await db.execute(sql`truncate ${users}, verifications cascade`);
  const user = await createUser(auth, {
    email: "counter@example.test",
    name: "Test counter",
    role: "counter",
    password: TEST_PASSWORD,
  });
  userId = user.id;
});

const context = (): AuditContext => ({ userId, requestId: "request-1" });
const entries = () => db.select().from(auditLog);
async function localeOf(id: string) {
  const [row] = await db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, id));
  return row!.locale;
}

/** The user's language changed to English, as PATCH /api/me does it. */
const toEnglish = (id: string) => ({
  action: "update" as const,
  entityType: "user",
  entityId: id,
  before: { locale: "es" },
  after: { locale: "en" },
});

/** Refused by the database: Drizzle wraps Postgres's error, so look in its cause too. */
async function expectRefused(write: Promise<unknown>, reason: RegExp) {
  const error = await write.then(
    () => null,
    (e: unknown) => e as Error & { cause?: unknown },
  );
  expect(error, "the database accepted it").not.toBeNull();
  expect(`${error!.message} ${String(error!.cause)}`).toMatch(reason);
}

describe("audited: a write and its audit entry are saved together, or not at all (#87)", () => {
  it("saves the change and one entry for it: who, what, which request, before and after", async () => {
    const result = await audited(db, context(), async (tx) => {
      await tx.update(users).set({ locale: "en" }).where(eq(users.id, userId));
      return { result: "done", changes: [toEnglish(userId)] };
    });

    expect(result).toBe("done");
    expect(await localeOf(userId)).toBe("en");
    expect(await entries()).toEqual([
      expect.objectContaining({
        userId,
        requestId: "request-1",
        action: "update",
        entityType: "user",
        entityId: userId,
        documentId: null,
        changes: { locale: { before: "es", after: "en" } },
      }),
    ]);
  });

  it("if the work fails after writing, neither the change nor an entry is saved", async () => {
    await expect(
      audited(db, context(), async (tx) => {
        await tx
          .update(users)
          .set({ locale: "en" })
          .where(eq(users.id, userId));
        throw new Error("something failed after the write");
      }),
    ).rejects.toThrow("something failed after the write");

    expect(await localeOf(userId)).toBe("es");
    expect(await entries()).toEqual([]);
  });

  it("if the entry can't be saved, the change is undone too", async () => {
    // An author who doesn't exist: the entry's foreign key refuses it.
    const nobody: AuditContext = { userId: randomUUIDv7(), requestId: "r" };
    await expectRefused(
      audited(db, nobody, async (tx) => {
        await tx
          .update(users)
          .set({ locale: "en" })
          .where(eq(users.id, userId));
        return { result: null, changes: [toEnglish(userId)] };
      }),
      /foreign key/,
    );

    expect(await localeOf(userId)).toBe("es");
    expect(await entries()).toEqual([]);
  });

  it("a change that changes nothing records nothing", async () => {
    await audited(db, context(), async () => ({
      result: null,
      changes: [{ ...toEnglish(userId), after: { locale: "es" } }],
    }));
    expect(await entries()).toEqual([]);
  });

  it("one entry per entity changed, each with its own document if it has one", async () => {
    const documentId = randomUUIDv7();
    await audited(db, context(), async () => ({
      result: null,
      changes: [toEnglish(userId), { ...toEnglish("other-user"), documentId }],
    }));
    const saved = await entries();
    expect(saved.map((e) => [e.entityId, e.documentId])).toEqual(
      expect.arrayContaining([
        [userId, null],
        ["other-user", documentId],
      ]),
    );
    expect(saved).toHaveLength(2);
  });

  it("a secret's value is never saved", async () => {
    await audited(db, context(), async () => ({
      result: null,
      changes: [
        {
          action: "update",
          entityType: "user",
          entityId: userId,
          before: { password: "old-password" },
          after: { password: "new-password" },
        },
      ],
    }));
    const [entry] = await entries();
    expect(entry!.changes).toEqual({
      password: { before: REDACTED, after: REDACTED },
    });
  });
});

describe("the audit log is append-only: the database refuses changes to it (decision 0025)", () => {
  beforeEach(async () => {
    await audited(db, context(), async () => ({
      result: null,
      changes: [toEnglish(userId)],
    }));
  });

  it("an update is refused", async () => {
    await expectRefused(
      db.update(auditLog).set({ action: "delete" }),
      /audit_log is append-only/,
    );
  });

  it("a delete is refused", async () => {
    await expectRefused(db.delete(auditLog), /audit_log is append-only/);
  });

  it("raw SQL is refused too: the rule is in the database, not the app", async () => {
    await expectRefused(
      db.execute(sql`update audit_log set request_id = 'changed'`),
      /audit_log is append-only/,
    );
    await expectRefused(
      db.execute(sql`delete from audit_log`),
      /audit_log is append-only/,
    );
    expect(await entries()).toHaveLength(1);
  });
});
