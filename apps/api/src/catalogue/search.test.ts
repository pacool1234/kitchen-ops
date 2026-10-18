import { StoreroomPage } from "@kitchen-ops/shared";
import fc from "fast-check";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { storerooms, users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { testConfig } from "../test/helpers";

// Search in every catalogue list (#88), checked against a plain reference: a name matches when
// it contains the text, ignoring case and accents. Run through the storerooms' list; the others
// search with the same `contains` (src/catalogue/lists.ts).

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

let cookie: string;
beforeAll(async () => {
  await db.execute(
    sql`truncate ${users}, ${storerooms}, verifications cascade`,
  );
  cookie = await signedInAs(app, auth, "office");
});

/** The reference: no accents, lower case. */
const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Spanish letters with and without accents, and the characters LIKE treats specially.
const character = fc.constantFrom(..."aAeEnNoOsSáÁéÉíÍñÑóÓúÚüÜ0 %_\\'-");
const name = fc
  .string({ unit: character, minLength: 1, maxLength: 10 })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
// Storeroom names are unique whatever their case.
const names = fc.uniqueArray(name, {
  minLength: 1,
  maxLength: 6,
  selector: (s) => s.toLowerCase(),
});

/** Part of a name, typed carelessly: some letters' case flipped, some accents dropped. */
const typedPart = (all: string[]) =>
  fc
    .tuple(
      fc.constantFrom(...all),
      fc.nat(),
      fc.nat(),
      fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
    )
    .map(([chosen, a, b, careless]) => {
      const start = a % chosen.length;
      const end = start + 1 + (b % (chosen.length - start));
      return [...chosen.slice(start, end)]
        .map((c, i) => {
          if (!careless[i]) return c;
          const plain = fold(c);
          return c === c.toLowerCase() ? plain.toUpperCase() : plain;
        })
        .join("");
    });

async function search(q: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/storerooms?status=all&pageSize=200&q=${encodeURIComponent(q)}`,
    headers: { cookie },
  });
  expect(response.statusCode, response.body).toBe(200);
  return StoreroomPage.parse(response.json()).items.map((s) => s.name);
}

describe("search (#88)", () => {
  it("finds exactly the names that contain the text, whatever its case and accents", async () => {
    await fc.assert(
      fc.asyncProperty(
        names.chain((all) =>
          fc.tuple(
            fc.constant(all),
            fc.oneof(
              typedPart(all),
              fc.string({ unit: character, maxLength: 3 }),
            ),
          ),
        ),
        async ([all, q]) => {
          await db.execute(sql`truncate ${storerooms} cascade`);
          for (const n of all) {
            const response = await app.inject({
              method: "POST",
              url: "/api/storerooms",
              headers: { cookie },
              payload: { name: n, type: "bar" },
            });
            expect(response.statusCode, response.body).toBe(201);
          }
          const expected = all.filter((n) => fold(n).includes(fold(q.trim())));
          expect((await search(q)).sort()).toEqual(expected.sort());
        },
      ),
      { numRuns: 40 },
    );
  });
});
