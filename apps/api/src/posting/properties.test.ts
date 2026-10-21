import {
  averageCost,
  formatMoney,
  formatUnitCost,
  latestPurchasePrice,
  parseUnitCost,
  stockOnHand,
  unitCostFromMillionths,
  valuation,
  type Movement,
} from "@kitchen-ops/ledger";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import fc from "fast-check";
import { randomUUIDv7 } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { auditLog, documentLines, documents, movements } from "../db/schema";
import { testConfig } from "../test/helpers";
import {
  documentToReview,
  reviewed,
  reviewedLine,
  setUpCatalogue,
  type PostingCatalogue,
} from "../test/posting";
import {
  databaseNow as readClock,
  postDocument,
  reverseDocument,
  type ReviewedLine,
} from "./posting";
import { recordStockDocument } from "../stock/record";
import { stockList } from "../stock/list";
import { productMovements } from "../stock/movements";
import { productStock } from "../stock/stock";
import { movementsOf } from "./stored";

// Spec 11.2 (M7): database-level property tests showing that stored movements and
// packages/ledger agree on stock and cost. Each run posts a random sequence of delivery notes,
// invoices (correcting delivery-note prices, and with lines of their own), waste, transfers and
// counts (#149), some counted before steps they're posted after, reversals and documents that
// can't be posted, through the posting and recording services into the test database.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
afterAll(close);

let c: PostingCatalogue;
beforeAll(async () => {
  c = await setUpCatalogue(db, auth);
});

/** Each run writes to the database, so fewer runs than a pure property. */
const RUNS = { numRuns: 15 };

const PRODUCTS = ["tomatoes", "eggs"] as const;
const UNIT = { tomatoes: "kg", eggs: "dozen" } as const;
const storeroom = fc.constantFrom(0, 1);
const product = fc.constantFrom(...PRODUCTS);
/** Per kg or dozen: up to €100. */
const price = fc.bigInt({ min: 0n, max: 10n ** 8n });

const step = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("note" as const),
      storeroom,
      lines: fc.array(
        fc.record({
          product,
          // Mostly deliveries, sometimes a return.
          quantity: fc.integer({ min: -2, max: 10 }).filter((q) => q !== 0),
          price,
          storeroom: fc.option(storeroom),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("invoice" as const),
      billed: fc.array(fc.record({ pick: fc.nat(), price: fc.option(price) }), {
        maxLength: 3,
      }),
      own: fc.array(
        fc.record({
          product,
          quantity: fc.integer({ min: 1, max: 10 }),
          price,
        }),
        { maxLength: 1 },
      ),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constantFrom("waste" as const, "transfer" as const),
      storeroom,
      // Some fit the stock there, and some don't.
      lines: fc.array(
        fc.record({ product, quantity: fc.integer({ min: 1, max: 6 }) }),
        { minLength: 1, maxLength: 2 },
      ),
      // Sometimes the same request sent twice: it posts once.
      twice: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("count" as const),
      storeroom,
      lines: fc.uniqueArray(
        fc.record({ product, quantity: fc.integer({ min: 0, max: 12 }) }),
        { minLength: 1, maxLength: 2, selector: (l) => l.product },
      ),
      // Counted now, or before an earlier step: a count synced late (#153).
      before: fc.option(fc.nat()),
      twice: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("reverse" as const),
      pick: fc.nat(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("broken" as const),
      at: fc.nat(),
    }),
  },
);
const steps = fc.array(step, { minLength: 1, maxLength: 6 });
type Step = typeof step extends fc.Arbitrary<infer T> ? T : never;

/** Everything posting can write, to compare before and after a step that fails. */
async function snapshot() {
  const [d, l, m, a] = await Promise.all([
    db.select().from(documents).orderBy(asc(documents.id)),
    db.select().from(documentLines).orderBy(asc(documentLines.id)),
    db.select().from(movements).orderBy(asc(movements.sequence)),
    db.select().from(auditLog).orderBy(asc(auditLog.id)),
  ]);
  return { d, l, m, a };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;

const context = () => ({ userId: c.userId, requestId: "property" });
const storeroomOf = (n: number) => (n === 0 ? c.coldRoom : c.dryStore);
const productOf = (p: (typeof PRODUCTS)[number]) => c[p];

/** The lines of posted delivery notes, not reversals: what an invoice can bill. */
const billableLines = () =>
  db
    .select({
      id: documentLines.id,
      productId: documentLines.productId,
      quantity: documentLines.quantity,
      unit: documentLines.unit,
      unitPrice: documentLines.unitPrice,
    })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(
      and(
        eq(documents.type, "delivery-note"),
        eq(documents.status, "posted"),
        isNull(documents.reverses),
      ),
    )
    .orderBy(asc(documentLines.id));

const postedDocuments = () =>
  db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.status, "posted"), isNull(documents.reverses)))
    .orderBy(asc(documents.id));

/**
 * The database's clock, which stamps movements, to the millisecond: what a count's time is
 * compared with. It waits for the clock to move on, so what's posted next is stamped later.
 */
async function databaseNow() {
  const read = () => readClock(db);
  const now = await read();
  let later = await read();
  while (later.getTime() === now.getTime()) later = await read();
  return now;
}

/** Runs the steps from an empty ledger. */
async function run(sequence: readonly Step[]) {
  await db.execute(sql`truncate ${documents} cascade`);
  const returned: Movement[] = [];
  const failures: { step: Step; before: Snapshot; after: Snapshot }[] = [];
  // Before each step: the time, and how many movements were posted by then.
  const marks: { at: Date; posted: number }[] = [];

  for (const s of sequence) {
    marks.push({ at: await databaseNow(), posted: returned.length });
    let lines: ReviewedLine[] = [];
    let type: "delivery-note" | "invoice" = "delivery-note";
    let storeroomId = c.coldRoom;
    switch (s.kind) {
      case "note":
        storeroomId = storeroomOf(s.storeroom);
        lines = s.lines.map((l) =>
          reviewedLine(
            productOf(l.product),
            String(l.quantity),
            UNIT[l.product],
            "0",
            {
              unitPrice: unitCostFromMillionths(l.price),
              ...(l.storeroom === null
                ? {}
                : { storeroomId: storeroomOf(l.storeroom) }),
            },
          ),
        );
        break;
      case "broken":
        lines = [reviewedLine(c.tomatoes, "1", "kg", "2.00")];
        lines.splice(
          s.at % 2,
          0,
          reviewedLine(c.tomatoes, "1", "crate", "2.00"),
        );
        break;
      case "invoice": {
        type = "invoice";
        const candidates = await billableLines();
        const picked = new Set<string>();
        for (const { pick, price: newPrice } of s.billed) {
          const line = candidates[pick % Math.max(candidates.length, 1)];
          if (line === undefined || picked.has(line.id)) continue;
          picked.add(line.id);
          lines.push({
            productId: line.productId,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice:
              newPrice === null
                ? // A delivery note's line always has a price.
                  parseUnitCost(line.unitPrice!)
                : unitCostFromMillionths(newPrice),
            billsLineId: line.id,
          });
        }
        for (const l of s.own) {
          lines.push(
            reviewedLine(
              productOf(l.product),
              String(l.quantity),
              UNIT[l.product],
              "0",
              { unitPrice: unitCostFromMillionths(l.price) },
            ),
          );
        }
        break;
      }
      case "reverse":
      case "waste":
      case "transfer":
      case "count":
        break;
    }

    if (s.kind === "count") {
      const storeroomId = storeroomOf(s.storeroom);
      const mark =
        s.before === null
          ? { at: await databaseNow(), posted: returned.length }
          : marks[s.before % marks.length]!;
      const id = randomUUIDv7();
      const record = () =>
        recordStockDocument(
          db,
          context(),
          id,
          {
            type: "count",
            storeroomId,
            countedAt: mark.at.toISOString(),
            lines: s.lines.map((l) => ({
              productId: productOf(l.product),
              quantity: String(l.quantity),
              unit: UNIT[l.product],
            })),
          },
          { date: "2026-10-21" },
        );
      const result = await record();
      // A count can't be refused: late and below zero, it's a flagged adjustment.
      if (!result.ok)
        throw new Error(`count refused: ${JSON.stringify(result)}`);
      // Each line is measured against the stock posted by the time it was counted.
      const then = returned.slice(0, mark.posted);
      s.lines.forEach((l, i) => {
        const p = productOf(l.product);
        const perUnit = l.product === "tomatoes" ? 1000 : 12_000;
        expect(result.movements[i]!.quantity).toBe(
          l.quantity * perUnit - stockOnHand(then, p, storeroomId),
        );
      });
      returned.push(...result.movements);
      if (s.twice) {
        expect(await record()).toEqual({ ok: true, movements: [] });
      }
      continue;
    }

    if (s.kind === "waste" || s.kind === "transfer") {
      const storeroomId = storeroomOf(s.storeroom);
      const lines = s.lines.map((l) => ({
        productId: productOf(l.product),
        quantity: String(l.quantity),
        unit: UNIT[l.product],
      }));
      const id = randomUUIDv7();
      const record = () =>
        recordStockDocument(
          db,
          context(),
          id,
          s.kind === "waste"
            ? {
                type: "waste",
                storeroomId,
                reason: "spoiled",
                note: null,
                lines,
              }
            : {
                type: "transfer",
                storeroomId,
                toStoreroomId: storeroomOf(1 - s.storeroom),
                lines,
              },
          { date: "2026-10-21" },
        );
      const before = await snapshot();
      const result = await record();
      if (result.ok) returned.push(...result.movements);
      else failures.push({ step: s, before, after: await snapshot() });
      if (s.twice) {
        // Posted once: sent again, it posts nothing more. Refused, it's refused again.
        const again = await record();
        expect(again).toEqual(result.ok ? { ok: true, movements: [] } : result);
        if (again.ok) returned.push(...again.movements);
      }
      continue;
    }
    if (s.kind === "reverse") {
      const posted = await postedDocuments();
      const target = posted[s.pick % Math.max(posted.length, 1)];
      if (target === undefined) continue;
      const before = await snapshot();
      const result = await reverseDocument(db, context(), target.id, {
        date: "2026-10-21",
      });
      if (result.ok) returned.push(...result.movements);
      else failures.push({ step: s, before, after: await snapshot() });
      continue;
    }
    if (lines.length === 0) continue;
    const id = await documentToReview(db, c);
    const before = await snapshot();
    const result = await postDocument(
      db,
      context(),
      id,
      reviewed(c, lines, { type, storeroomId }),
    );
    if (result.ok) returned.push(...result.movements);
    else failures.push({ step: s, before, after: await snapshot() });
  }
  return { returned, failures, stored: await movementsOf(db) };
}

const locations = () =>
  [c.tomatoes, c.eggs].flatMap((p) =>
    [c.coldRoom, c.dryStore].map((s) => [p, s] as const),
  );

describe("stored movements agree with packages/ledger (spec 11.2, decision 0034)", () => {
  it("invariant 1: whatever is posted and reversed, every product's stock in every storeroom read back from the database equals the ledger's stock from the movements posting returned, and SQL's own sum", async () => {
    await fc.assert(
      fc.asyncProperty(steps, async (sequence) => {
        const { returned, stored } = await run(sequence);
        const sums = await db
          .select({
            productId: movements.productId,
            storeroomId: movements.storeroomId,
            total: sql<string>`sum(${movements.quantity})`,
          })
          .from(movements)
          .groupBy(movements.productId, movements.storeroomId);
        for (const [p, s] of locations()) {
          const fromSql = Number(
            sums.find((r) => r.productId === p && r.storeroomId === s)?.total ??
              0,
          );
          expect(stockOnHand(stored, p, s)).toBe(stockOnHand(returned, p, s));
          expect(stockOnHand(stored, p, s)).toBe(fromSql);
        }
      }),
      RUNS,
    );
  });

  it("invariant 5: the movements read back are exactly the ones posting returned, in the same order, so they give the same average costs and latest purchase prices", async () => {
    await fc.assert(
      fc.asyncProperty(steps, async (sequence) => {
        const { returned, stored } = await run(sequence);
        expect(stored).toEqual(returned);
        for (const [p, s] of locations()) {
          expect(averageCost(stored, p, s)).toBe(averageCost(returned, p, s));
        }
        for (const p of [c.tomatoes, c.eggs]) {
          expect(latestPurchasePrice(stored, p)).toBe(
            latestPurchasePrice(returned, p),
          );
        }
      }),
      RUNS,
    );
  });

  it("the stock a product's page shows (#120): each storeroom it has moved through, and only those, with the ledger's stock and average cost from the movements posting returned", async () => {
    await fc.assert(
      fc.asyncProperty(steps, async (sequence) => {
        const { returned } = await run(sequence);
        for (const p of [c.tomatoes, c.eggs]) {
          const shown = (await productStock(db, p))!;
          const moved = [c.coldRoom, c.dryStore].filter((s) =>
            returned.some((m) => m.productId === p && m.storeroomId === s),
          );
          expect(shown.storerooms.map((r) => r.storeroom.id).sort()).toEqual(
            moved.sort(),
          );
          for (const {
            storeroom,
            onHand,
            averageCost: cost,
          } of shown.storerooms) {
            expect(onHand).toBe(stockOnHand(returned, p, storeroom.id));
            expect(cost).toBe(
              formatUnitCost(averageCost(returned, p, storeroom.id)),
            );
          }
        }
      }),
      RUNS,
    );
  });

  it("the stock list (#150), page by page: every product in every storeroom with movements, each once, with the ledger's stock, average cost and value; and its totals, each storeroom's and the whole stock's", async () => {
    await fc.assert(
      fc.asyncProperty(
        steps,
        fc.integer({ min: 1, max: 3 }),
        async (sequence, pageSize) => {
          const { returned } = await run(sequence);
          const expected = valuation(returned);
          const listed = [];
          let totals;
          for (let page = 1; ; page++) {
            const answer = await stockList(
              db,
              { page, pageSize },
              { costs: true },
            );
            totals ??= answer.totals;
            listed.push(...answer.items);
            if (page * pageSize >= answer.total) break;
          }
          expect(listed).toHaveLength(expected.places.length);
          for (const place of expected.places) {
            const found = listed.filter(
              (l) =>
                l.product.id === place.productId &&
                l.storeroom.id === place.storeroomId,
            );
            expect(found).toEqual([
              expect.objectContaining({
                onHand: place.onHand,
                averageCost: formatUnitCost(place.averageCost),
                value: formatMoney(place.value),
              }),
            ]);
          }
          expect(totals?.value).toBe(formatMoney(expected.total));
          expect(
            new Map(
              totals?.storerooms.map((s) => [s.storeroom.id, s.value]) ?? [],
            ),
          ).toEqual(
            new Map(
              [...expected.storerooms].map(([id, value]) => [
                id,
                formatMoney(value),
              ]),
            ),
          );
        },
      ),
      RUNS,
    );
  });

  it("a product's movements (#150), page by page: its stored movements, newest first, none missing and none twice", async () => {
    await fc.assert(
      fc.asyncProperty(
        steps,
        fc.integer({ min: 1, max: 3 }),
        async (sequence, pageSize) => {
          const { returned } = await run(sequence);
          for (const p of [c.tomatoes, c.eggs]) {
            const listed: string[] = [];
            for (let page = 1; ; page++) {
              const answer = (await productMovements(
                db,
                p,
                { page, pageSize },
                { costs: true },
              ))!;
              listed.push(...answer.items.map((m) => m.id));
              if (page * pageSize >= answer.total) break;
            }
            expect(listed).toEqual(
              returned
                .filter((m) => m.productId === p)
                .map((m) => m.id)
                .reverse(),
            );
          }
        },
      ),
      RUNS,
    );
  });

  it("invariant 4: a posting or reversal that fails leaves every table exactly as it was, the audit log included", async () => {
    await fc.assert(
      fc.asyncProperty(steps, async (sequence) => {
        const { failures } = await run(sequence);
        for (const { before, after } of failures) {
          expect(after).toEqual(before);
        }
      }),
      RUNS,
    );
  });

  it("invariant 2: every stored movement points to a line of a posted document", async () => {
    await fc.assert(
      fc.asyncProperty(steps, async (sequence) => {
        await run(sequence);
        const orphans = await db
          .select({ id: movements.id })
          .from(movements)
          .innerJoin(
            documentLines,
            eq(documentLines.id, movements.documentLineId),
          )
          .innerJoin(documents, eq(documents.id, documentLines.documentId))
          .where(sql`${documents.status}::text <> 'posted'`);
        expect(orphans).toEqual([]);
      }),
      RUNS,
    );
  });
});
