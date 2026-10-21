import { MeResponse, StockPage } from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import {
  documents,
  products,
  storerooms,
  suppliers,
  users,
} from "../db/schema";
import { createMemoryStorage } from "../storage/memory";
import { signedInAs } from "../test/auth";
import { apiAs } from "../test/catalogue";
import { testConfig } from "../test/helpers";

// The stock list's performance budget (spec 11.2, decision 0045): a year of a restaurant the
// size spec 11.1 designs for, about 400 products and 300 documents a month, stays instant.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config, { storage: createMemoryStorage() });
afterAll(async () => {
  await app.close();
  await close();
});

/** The first answer after a posting: every movement read and valued again. */
const FIRST_BUDGET_MS = 1000;
/** Every answer after it, until something more is posted: a search as it's typed. */
const BUDGET_MS = 100;

let office: ReturnType<typeof apiAs>;

beforeAll(async () => {
  await db.execute(
    sql`truncate ${users}, ${documents}, ${products}, ${storerooms}, ${suppliers}, verifications cascade`,
  );
  office = apiAs(app, await signedInAs(app, auth, "office"));
  const { id: officeId } = await office.read("/api/me", MeResponse);
  // Written straight to the tables: posting 3600 documents one by one would take minutes.
  await db.execute(
    sql`insert into suppliers (name, tax_id) values ('Proveedor', 'B00000000')`,
  );
  await db.execute(
    sql`insert into storerooms (name, type) values ('Cámara', 'cold_room'), ('Almacén', 'dry_store')`,
  );
  await db.execute(
    sql`insert into products (name, base_unit) select 'Producto ' || n, 'g' from generate_series(1, 400) n`,
  );
  // A year: 3600 delivery notes of 12 lines each.
  await db.execute(sql`
    insert into documents (status, type, date, supplier_id, uploaded_by)
    select 'posted', 'delivery-note', date '2026-01-01' + (n % 365), (select id from suppliers), ${officeId}
    from generate_series(1, 3600) n`);
  await db.execute(sql`
    with d as (select id, row_number() over (order by id) n from documents),
         p as (select id, row_number() over (order by id) - 1 k from products)
    insert into document_lines (id, document_id, position, product_id, quantity, unit, unit_price)
    select gen_random_uuid(), d.id, g, p.id, 1 + (d.n % 9), 'g', 0.5 + (d.n % 7)
    from d cross join generate_series(1, 12) g
    join p on p.k = (d.n * 12 + g) % 400`);
  await db.execute(sql`
    insert into movements (id, product_id, storeroom_id, quantity, unit_cost, document_line_id, kind)
    select gen_random_uuid(), l.product_id,
      (select id from storerooms order by name offset (l.position % 2) limit 1),
      l.quantity * 1000, l.unit_price / 1000, l.id, 'receipt'
    from document_lines l order by l.document_id, l.position`);
}, 120_000);

async function timed(query: string) {
  const start = performance.now();
  const response = await office.send("GET", `/api/stock${query}`);
  const ms = performance.now() - start;
  expect(response.statusCode).toBe(200);
  return { ms, page: StockPage.parse(response.json()) };
}

describe("GET /api/stock with a year of movements", () => {
  it(`answers within ${FIRST_BUDGET_MS} ms after a posting, and within ${BUDGET_MS} ms (the median) while searching`, async () => {
    const first = await timed("");
    expect(first.page.total).toBe(400);
    expect(first.ms).toBeLessThan(FIRST_BUDGET_MS);

    const searches = ["?q=producto 1", "?q=producto 12", "?q=producto 123"];
    const times = [];
    for (const query of [...searches, ...searches]) {
      times.push((await timed(query)).ms);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(BUDGET_MS);
  });
});
