import {
  averageCost,
  formatUnitCost,
  latestPurchasePrice,
  parseUnitCost,
  stockOnHand,
  unitCostFromMillionths,
  type Movement,
} from "@kitchen-ops/ledger";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import fc from "fast-check";
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
import { postDocument, reverseDocument, type ReviewedLine } from "./posting";
import { productStock } from "../stock/stock";
import { movementsOf } from "./stored";

// Spec 11.2 (M7): database-level property tests showing that stored movements and
// packages/ledger agree on stock and cost. Each run posts a random sequence of delivery notes,
// invoices (correcting delivery-note prices, and with lines of their own), reversals and
// documents that can't be posted, through the posting service into the test database.

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

/** Runs the steps from an empty ledger. */
async function run(sequence: readonly Step[]) {
  await db.execute(sql`truncate ${documents} cascade`);
  const returned: Movement[] = [];
  const failures: { step: Step; before: Snapshot; after: Snapshot }[] = [];

  for (const s of sequence) {
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
                ? parseUnitCost(line.unitPrice)
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
        break;
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
