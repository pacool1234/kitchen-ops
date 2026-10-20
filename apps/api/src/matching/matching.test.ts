import {
  DocumentMatching,
  MeResponse,
  NEW_SUPPLIER_DOCUMENTS,
  Product,
  Supplier,
  SupplierProduct,
  SupplierProductPage,
} from "@kitchen-ops/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { documents, products, suppliers, users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { apiAs, syntheticCif } from "../test/catalogue";
import { testConfig } from "../test/helpers";
import { documentRead, draftWith, postedFrom } from "../test/matching";

// Matching a document to the catalogue (#117, decision 0035): its supplier, each line's
// supplier product, and why it needs review; choosing the supplier; and remembering a line as
// a supplier product. The rules themselves are in match.test.ts, the audit entries in
// src/audit/writes-audited.test.ts.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

const MISSING = "0199a000-0000-7000-8000-000000000000";

let office: ReturnType<typeof apiAs>;
let officeId: string;
let huerto: Supplier;
let granja: Supplier;
let tomate: Product;
let aceite: Product;
let tomateKilo: SupplierProduct;
let aceiteGarrafa: SupplierProduct;

beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${documents}, ${products}, ${suppliers}, verifications cascade`,
  );
  const cookie = await signedInAs(app, auth, "office");
  office = apiAs(app, cookie);
  officeId = (await office.read("/api/me", MeResponse)).id;
  huerto = await office.created(
    "/api/suppliers",
    // Not the fake model's supplier, B00000018 (syntheticCif(1)): that one is created in a test.
    { name: "Frutas El Huerto, S.L.", taxId: syntheticCif(11) },
    Supplier,
  );
  granja = await office.created(
    "/api/suppliers",
    { name: "Granja Los Robles, S.L.", taxId: syntheticCif(12) },
    Supplier,
  );
  tomate = await office.created(
    "/api/products",
    {
      name: "Tomate pera",
      baseUnit: "g",
      category: "produce",
      conversions: [
        { unit: "kg", factor: 1000 },
        { unit: "caja", factor: 6000 },
      ],
    },
    Product,
  );
  aceite = await office.created(
    "/api/products",
    {
      name: "Aceite de oliva virgen extra",
      baseUnit: "ml",
      category: "dry_goods",
      conversions: [{ unit: "l", factor: 1000 }],
    },
    Product,
  );
  tomateKilo = await office.created(
    "/api/supplier-products",
    {
      supplierId: huerto.id,
      code: "T-01",
      description: "Tomate pera, kilo",
      productId: tomate.id,
      pack: { quantity: "1", unit: "kg" },
    },
    SupplierProduct,
  );
  aceiteGarrafa = await office.created(
    "/api/supplier-products",
    {
      supplierId: huerto.id,
      code: null,
      description: "Aceite de oliva virgen extra 5 l",
      productId: aceite.id,
      pack: { quantity: "5", unit: "l" },
    },
    SupplierProduct,
  );
});

/** Tomatoes by code, oil by description, and a line nobody has seen. */
const threeLines = () =>
  draftWith([
    { supplierCode: "T-01", description: "Tomate pera" },
    { supplierCode: null, description: "ACEITE DE OLIVA VIRGEN EXTRA  5 L" },
    { supplierCode: "C-07", description: "Cebolla dulce" },
  ]);

const matching = (id: string, api = office) =>
  api.read(`/api/documents/${id}/matching`, DocumentMatching);

const establish = async (supplierId: string) => {
  for (let i = 0; i < NEW_SUPPLIER_DOCUMENTS; i++) {
    await postedFrom(db, officeId, supplierId);
  }
};

const allOffers = () =>
  office.read("/api/supplier-products?status=all", SupplierProductPage);

describe("GET /api/documents/:id/matching", () => {
  it("the supplier found by tax ID, lines matched by code and by description, one not matched, and why it needs review", async () => {
    const id = await documentRead(db, {
      uploadedBy: officeId,
      supplierId: huerto.id,
      draft: threeLines(),
    });
    expect(await matching(id)).toEqual({
      supplier: { id: huerto.id, name: huerto.name, taxId: huerto.taxId },
      newSupplier: true,
      lines: [
        { line: 1, match: { by: "code", supplierProduct: tomateKilo } },
        {
          line: 2,
          match: { by: "description", supplierProduct: aceiteGarrafa },
        },
        { line: 3, match: null },
      ],
      reviewReasons: ["new_supplier", "unmapped_lines"],
    });
  });

  it("an established supplier, every line matched and every check passed: nothing to review", async () => {
    await establish(huerto.id);
    const id = await documentRead(db, {
      uploadedBy: officeId,
      supplierId: huerto.id,
      draft: draftWith([{ supplierCode: "T-01", description: null }]),
    });
    const found = await matching(id);
    expect(found.newSupplier).toBe(false);
    expect(found.reviewReasons).toEqual([]);
  });

  it("no supplier: no line can match, whatever its code", async () => {
    const id = await documentRead(db, {
      uploadedBy: officeId,
      draft: threeLines(),
      failedChecks: true,
    });
    expect(await matching(id)).toEqual({
      supplier: null,
      newSupplier: false,
      lines: [1, 2, 3].map((line) => ({ line, match: null })),
      reviewReasons: ["failed_checks", "no_supplier", "unmapped_lines"],
    });
  });

  it("no draft: no lines, and nothing read to post", async () => {
    await establish(huerto.id);
    const id = await documentRead(db, {
      uploadedBy: officeId,
      supplierId: huerto.id,
    });
    expect(await matching(id)).toMatchObject({
      lines: [],
      reviewReasons: ["no_draft"],
    });
  });

  it(`a supplier is new until it has ${NEW_SUPPLIER_DOCUMENTS} posted documents; one reversed, and its reversal, don't count`, async () => {
    const id = await documentRead(db, {
      uploadedBy: officeId,
      supplierId: huerto.id,
      draft: draftWith([{ supplierCode: "T-01", description: null }]),
    });
    for (let i = 1; i < NEW_SUPPLIER_DOCUMENTS; i++) {
      await postedFrom(db, officeId, huerto.id);
    }
    await postedFrom(db, officeId, huerto.id, { reversed: true });
    // Another supplier's documents, and this one's still in review, don't count either.
    await establish(granja.id);
    await documentRead(db, { uploadedBy: officeId, supplierId: huerto.id });
    expect(await matching(id)).toMatchObject({
      newSupplier: true,
      reviewReasons: ["new_supplier"],
    });

    await postedFrom(db, officeId, huerto.id);
    expect(await matching(id)).toMatchObject({
      newSupplier: false,
      reviewReasons: [],
    });
  });

  it("only active supplier products of active products match", async () => {
    await office.updated(
      `/api/supplier-products/${tomateKilo.id}`,
      { active: false },
      SupplierProduct,
    );
    await office.updated(
      `/api/products/${aceite.id}`,
      { active: false },
      Product,
    );
    const id = await documentRead(db, {
      uploadedBy: officeId,
      supplierId: huerto.id,
      draft: threeLines(),
    });
    expect((await matching(id)).lines.map((l) => l.match)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("every role reads it; a document that doesn't exist, or a reversal, answers 404", async () => {
    const id = await documentRead(db, {
      uploadedBy: officeId,
      supplierId: huerto.id,
      draft: threeLines(),
    });
    const counter = apiAs(app, await signedInAs(app, auth, "counter"));
    expect((await matching(id, counter)).lines).toHaveLength(3);

    const posted = await postedFrom(db, officeId, huerto.id, {
      reversed: true,
    });
    const [reversal] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.reverses, posted));
    for (const missing of [MISSING, reversal!.id]) {
      const response = await office.send(
        "GET",
        `/api/documents/${missing}/matching`,
      );
      expect(response.statusCode).toBe(404);
    }
  });
});

describe("PUT /api/documents/:id/supplier", () => {
  const choose = (id: string, supplierId: string, api = office) =>
    api.send("PUT", `/api/documents/${id}/supplier`, { supplierId });

  it("chooses the supplier, and the lines match its supplier products", async () => {
    const id = await documentRead(db, {
      uploadedBy: officeId,
      supplierId: granja.id,
      draft: threeLines(),
    });
    expect((await matching(id)).lines.every((l) => l.match === null)).toBe(
      true,
    );

    const response = await choose(id, huerto.id);
    expect(response.statusCode).toBe(200);
    const chosen = DocumentMatching.parse(response.json());
    expect(chosen.supplier?.id).toBe(huerto.id);
    expect(chosen.lines.map((l) => l.match?.by ?? null)).toEqual([
      "code",
      "description",
      null,
    ]);
    expect(await matching(id)).toEqual(chosen);
  });

  it("a supplier created on the spot, from what was read, can be chosen", async () => {
    const id = await documentRead(db, {
      uploadedBy: officeId,
      draft: threeLines(),
    });
    const read = threeLines().supplier;
    const created = await office.created(
      "/api/suppliers",
      { name: read.name, taxId: read.taxId },
      Supplier,
    );
    expect((await choose(id, created.id)).statusCode).toBe(200);
    expect(await matching(id)).toMatchObject({
      supplier: { id: created.id, taxId: "B00000018" },
      newSupplier: true,
    });
  });

  it("refuses a supplier that doesn't exist, or an inactive one: 400", async () => {
    const id = await documentRead(db, { uploadedBy: officeId });
    const missing = await choose(id, MISSING);
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({
      error: "invalid_input",
      fields: { supplierId: "not_found" },
    });

    await office.updated(
      `/api/suppliers/${granja.id}`,
      { active: false },
      Supplier,
    );
    const response = await choose(id, granja.id);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_input",
      fields: { supplierId: "invalid" },
    });
  });

  it.each(["queued", "failed"] as const)(
    "refuses a document that's %s: 409 not_in_review, and changes nothing",
    async (status) => {
      const id = await documentRead(db, { uploadedBy: officeId, status });
      const response = await choose(id, huerto.id);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "not_in_review" });
      const [row] = await db
        .select({ supplierId: documents.supplierId })
        .from(documents)
        .where(eq(documents.id, id));
      expect(row?.supplierId).toBeNull();
    },
  );

  it("refuses a posted document (409), and one that doesn't exist (404)", async () => {
    const posted = await postedFrom(db, officeId, granja.id);
    expect((await choose(posted, huerto.id)).statusCode).toBe(409);
    expect((await choose(MISSING, huerto.id)).statusCode).toBe(404);
  });

  it("is for office and owner: a counter user is refused (403)", async () => {
    const id = await documentRead(db, { uploadedBy: officeId });
    const counter = apiAs(app, await signedInAs(app, auth, "counter"));
    expect((await choose(id, huerto.id, counter)).statusCode).toBe(403);
  });
});

describe("POST /api/documents/:id/lines/:line/mapping", () => {
  const remember = (
    id: string,
    line: number | string,
    body: object,
    api = office,
  ) => api.send("POST", `/api/documents/${id}/lines/${line}/mapping`, body);
  /** Our tomatoes, by the kilo: any product will do. */
  const mapping = () => ({
    productId: tomate.id,
    pack: { quantity: "1", unit: "kg" },
  });

  /** A document from the orchard with these lines. */
  const fromHuerto = (
    lines: Parameters<typeof draftWith>[0],
    supplierId: string | null = huerto.id,
  ) =>
    documentRead(db, {
      uploadedBy: officeId,
      supplierId,
      draft: draftWith(lines),
    });

  it("remembers a line with a code: the line matches now, and on the supplier's next document", async () => {
    const id = await documentRead(db, {
      uploadedBy: officeId,
      supplierId: huerto.id,
      draft: threeLines(),
    });
    const response = await remember(id, 3, {
      productId: tomate.id,
      pack: { quantity: "6", unit: "kg" },
    });
    expect(response.statusCode).toBe(201);
    const after = DocumentMatching.parse(response.json());
    expect(after.lines[2]?.match).toEqual({
      by: "code",
      supplierProduct: {
        id: expect.any(String),
        supplier: { id: huerto.id, name: huerto.name },
        code: "C-07",
        description: "Cebolla dulce",
        product: { id: tomate.id, name: tomate.name, baseUnit: "g" },
        pack: { quantity: "6", unit: "kg" },
        packBaseUnits: 6000,
        active: true,
      },
    });
    expect(after.reviewReasons).toEqual(["new_supplier"]);

    const next = await fromHuerto([
      { supplierCode: "C-07", description: "Cebolla dulce, malla" },
    ]);
    expect((await matching(next)).lines[0]?.match?.supplierProduct.id).toBe(
      after.lines[2]?.match?.supplierProduct.id,
    );
  });

  it("remembers a line without a code by its description, as printed", async () => {
    const id = await fromHuerto([
      { supplierCode: "  ", description: " Lechuga  romana " },
    ]);
    const response = await remember(id, 1, mapping());
    expect(response.statusCode).toBe(201);
    const remembered = DocumentMatching.parse(response.json()).lines[0]?.match;
    expect(remembered).toMatchObject({
      by: "description",
      supplierProduct: { code: null, description: "Lechuga  romana" },
    });

    const next = await fromHuerto([
      { supplierCode: null, description: "LECHUGA ROMANA" },
    ]);
    expect((await matching(next)).lines[0]?.match?.by).toBe("description");
  });

  it.each([
    [
      "a code already the supplier's, even an inactive supplier product's",
      { supplierCode: "T-01", description: "Tomate" },
      { code: "taken" },
    ],
    [
      "no code, and a description already the supplier's",
      { supplierCode: null, description: "aceite de oliva virgen extra 5 l" },
      { description: "taken" },
    ],
    [
      "no description",
      { supplierCode: "N-01", description: null },
      { description: "required" },
    ],
    [
      "a code too long to keep",
      { supplierCode: "x".repeat(51), description: "Tomate" },
      { code: "too_long" },
    ],
  ])(
    "refuses a line with %s: 409, and remembers nothing",
    async (_, line, fields) => {
      await office.updated(
        `/api/supplier-products/${tomateKilo.id}`,
        { active: false },
        SupplierProduct,
      );
      const id = await fromHuerto([line]);
      const response = await remember(id, 1, mapping());
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "conflict", fields });
      expect((await allOffers()).total).toBe(2);
    },
  );

  it.each([
    [{ productId: MISSING }, { productId: "not_found" }],
    [
      { pack: { quantity: "1", unit: "docena" } },
      { "pack.unit": "unknown_unit" },
    ],
    [{ pack: { quantity: "0", unit: "kg" } }, { "pack.quantity": "too_small" }],
    [{ supplierId: MISSING }, { supplierId: "unknown_field" }],
  ])("refuses %j: 400, and remembers nothing", async (change, fields) => {
    const id = await fromHuerto([
      { supplierCode: "C-07", description: "Cebolla" },
    ]);
    const response = await remember(id, 1, { ...mapping(), ...change });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_input", fields });
    expect((await allOffers()).total).toBe(2);
  });

  it("refuses a document without a supplier: 409 no_supplier", async () => {
    const id = await fromHuerto(
      [{ supplierCode: "C-07", description: "Cebolla" }],
      null,
    );
    const response = await remember(id, 1, mapping());
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "no_supplier" });
  });

  it("refuses a document not in review: 409 not_in_review", async () => {
    const posted = await postedFrom(db, officeId, huerto.id);
    const response = await remember(posted, 1, mapping());
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "not_in_review" });
  });

  it("a line that isn't there: 404, or 400 for line 0", async () => {
    const id = await fromHuerto([
      { supplierCode: "C-07", description: "Cebolla" },
    ]);
    const noDraft = await documentRead(db, {
      uploadedBy: officeId,
      supplierId: huerto.id,
    });
    expect((await remember(id, 2, mapping())).statusCode).toBe(404);
    expect((await remember(noDraft, 1, mapping())).statusCode).toBe(404);
    expect((await remember(MISSING, 1, mapping())).statusCode).toBe(404);
    expect((await remember(id, 0, mapping())).statusCode).toBe(400);
    expect((await remember(id, "first", mapping())).statusCode).toBe(400);
    expect((await allOffers()).total).toBe(2);
  });

  it("is for office and owner: a counter user is refused (403)", async () => {
    const id = await fromHuerto([
      { supplierCode: "C-07", description: "Cebolla" },
    ]);
    const counter = apiAs(app, await signedInAs(app, auth, "counter"));
    expect((await remember(id, 1, mapping(), counter)).statusCode).toBe(403);
  });
});
