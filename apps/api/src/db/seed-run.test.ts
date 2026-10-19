import { count, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createAuth } from "../auth/auth";
import { testConfig } from "../test/helpers";
import { createDb } from "./client";
import {
  products,
  storerooms,
  supplierProducts,
  suppliers,
  unitConversions,
  users,
} from "./schema";
import { DEMO_PASSWORD_MIN, planSeed } from "./seed-plan";
import { runSeed } from "./seed-run";

// Staging's demo is seeded on every start (#100): the first start fills an empty database, and
// every later one changes nothing, so what's been created since is kept.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
afterAll(close);

const quiet = () => {};
const counts = async () =>
  Object.fromEntries(
    await Promise.all(
      Object.entries({
        storerooms,
        suppliers,
        products,
        unitConversions,
        supplierProducts,
        users,
      }).map(async ([name, table]) => {
        const [row] = await db.select({ n: count() }).from(table);
        return [name, row!.n] as const;
      }),
    ),
  );

const demo = planSeed({
  NODE_ENV: "production",
  SEED_DEMO: "true",
  DEMO_PASSWORD_COUNTER: "c".repeat(DEMO_PASSWORD_MIN),
  DEMO_PASSWORD_OFFICE: "o".repeat(DEMO_PASSWORD_MIN),
  DEMO_PASSWORD_OWNER: "w".repeat(DEMO_PASSWORD_MIN),
});

describe("runSeed (#100)", () => {
  it("fills an empty database once; a second run changes nothing", async () => {
    await db.execute(
      sql`truncate ${users}, ${products}, ${storerooms}, ${suppliers}, verifications cascade`,
    );
    const auth = createAuth(db, config);

    await runSeed(db, auth, demo, quiet);
    const first = await counts();
    expect(first).toEqual({
      storerooms: 3,
      suppliers: 8,
      products: 44,
      unitConversions: expect.any(Number),
      supplierProducts: 48,
      users: 3,
    });

    await runSeed(db, auth, demo, quiet);
    expect(await counts()).toEqual(first);
  });

  it("keeps what was created since: a table with rows is left as it is", async () => {
    await db.execute(sql`truncate ${storerooms} cascade`);
    await db.insert(storerooms).values({ name: "Terraza", type: "bar" });
    await runSeed(db, createAuth(db, config), demo, quiet);
    expect(
      (await db.select({ name: storerooms.name }).from(storerooms)).map(
        (s) => s.name,
      ),
    ).toEqual(["Terraza"]);
  });

  it("the demo owner, like every owner, must still set up 2FA", async () => {
    const [owner] = await db
      .select({ twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.email, "owner@example.test"));
    expect(owner?.twoFactorEnabled).toBe(false);
  });
});
