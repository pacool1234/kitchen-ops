import { createHash } from "node:crypto";
import {
  Document,
  DocumentPage,
  UPLOAD_LIMITS,
  type Role,
} from "@kitchen-ops/shared";
import fc from "fast-check";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { documentFiles, documents, users } from "../db/schema";
import { READ_QUEUE } from "../extraction/jobs";
import { createMemoryStorage } from "../storage/memory";
import { signedInAs, signedInAsOwner } from "../test/auth";
import { multipart, sample, type UploadFile } from "../test/documents";
import { testConfig } from "../test/helpers";

// Documents and their files (#102): uploaded once, kept in object storage, a duplicate caught by
// its sha256, and read back with short-lived links. Storage is the in-memory stand-in here;
// src/storage/s3.test.ts runs the real client against the local S3 server.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const storage = createMemoryStorage();
const app = buildApp(config, { storage });
afterAll(async () => {
  await app.close();
  await close();
});

let cookie: string;
beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${documents}, verifications cascade`);
  await db.execute(sql`delete from pgboss.job`);
  storage.clear();
  cookie = await signedInAs(app, auth, "office");
});

const upload = (files: readonly UploadFile[], as = cookie) => {
  const body = multipart(files);
  return app.inject({
    method: "POST",
    url: "/api/documents",
    headers: { ...body.headers, cookie: as },
    payload: body.payload,
  });
};

async function uploaded(files: readonly UploadFile[]) {
  const response = await upload(files);
  expect(response.statusCode, response.body).toBe(201);
  return Document.parse(response.json());
}

/** The documents a reading job is queued for (#104), in pg-boss's own table. */
async function queuedReads(): Promise<string[]> {
  const { rows } = await db.execute<{ documentId: string }>(
    sql`select data->>'documentId' as "documentId" from pgboss.job where name = ${READ_QUEUE} and state = 'created'`,
  );
  return rows.map((r) => r.documentId);
}

const read = (url: string) =>
  app.inject({ method: "GET", url, headers: { cookie } });
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("POST /api/documents", () => {
  it("one PDF: a queued document, its file stored as it came", async () => {
    const bytes = sample.pdf(1);
    const document = await uploaded([{ name: "albaran.pdf", bytes }]);
    expect(document).toMatchObject({
      status: "queued",
      type: null,
      supplier: null,
      number: null,
      date: null,
      fileCount: 1,
      uploadedBy: { name: "Test office" },
      files: [
        {
          position: 1,
          kind: "pdf",
          contentType: "application/pdf",
          sizeBytes: bytes.length,
        },
      ],
    });
    expect(storage.keys()).toHaveLength(1);
    expect(await storage.get(storage.keys()[0]!)).toEqual(bytes);
    // Queued to be read, in the same transaction as the document (#104).
    expect(await queuedReads()).toEqual([document.id]);
  });

  it("a Facturae XML file", async () => {
    const document = await uploaded([
      { name: "factura.xml", bytes: sample.xml(1) },
    ]);
    expect(document.files).toMatchObject([
      { kind: "xml", contentType: "application/xml" },
    ]);
  });

  it("three photos make one document, in the order they were sent", async () => {
    const document = await uploaded([
      { name: "1.jpg", bytes: sample.jpeg(1) },
      { name: "2.png", bytes: sample.png(2) },
      { name: "3.jpg", bytes: sample.jpeg(3) },
    ]);
    expect(
      document.files.map((f) => [f.position, f.kind, f.contentType]),
    ).toEqual([
      [1, "image", "image/jpeg"],
      [2, "image", "image/png"],
      [3, "image", "image/jpeg"],
    ]);
    expect(document.fileCount).toBe(3);
  });

  it("the type comes from the bytes, not the name or what the browser says", async () => {
    const document = await uploaded([
      { name: "foto.pdf", bytes: sample.png(1), type: "application/pdf" },
    ]);
    expect(document.files[0]).toMatchObject({
      kind: "image",
      contentType: "image/png",
    });
  });

  it.each([
    ["no file", [], { files: "required" }],
    [
      `${UPLOAD_LIMITS.maxPhotos + 1} photos`,
      Array.from({ length: UPLOAD_LIMITS.maxPhotos + 1 }, (_, i) => ({
        name: `${i}.jpg`,
        bytes: sample.jpeg(i),
      })),
      { files: "too_many" },
    ],
    [
      "a file over 20 MB",
      [
        {
          name: "big.pdf",
          bytes: sample.pdfOfSize(UPLOAD_LIMITS.maxFileBytes + 1),
        },
      ],
      { "files.1": "too_big" },
    ],
    [
      "a PDF with a photo",
      [
        { name: "a.pdf", bytes: sample.pdf(1) },
        { name: "b.jpg", bytes: sample.jpeg(2) },
      ],
      { files: "mixed_kinds" },
    ],
    [
      "two PDFs",
      [
        { name: "a.pdf", bytes: sample.pdf(1) },
        { name: "b.pdf", bytes: sample.pdf(2) },
      ],
      { files: "mixed_kinds" },
    ],
    [
      "a text file named .pdf",
      [{ name: "notas.pdf", bytes: sample.plainText(1) }],
      { "files.1": "unsupported_type" },
    ],
    [
      "an iPhone HEIC photo",
      [{ name: "IMG_0001.heic", bytes: sample.heic(1) }],
      { "files.1": "unsupported_type" },
    ],
  ] as const)(
    "refuses %s, naming the field: 400, and stores nothing",
    async (_, files, fields) => {
      const response = await upload(files);
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_input", fields });
      expect(storage.keys()).toEqual([]);
      expect(await db.select().from(documents)).toEqual([]);
      expect(await queuedReads()).toEqual([]);
    },
  );

  it("a file already received: 409, naming the document that has it, and nothing new stored", async () => {
    const first = await uploaded([{ name: "a.pdf", bytes: sample.pdf(1) }]);
    const again = await upload([{ name: "copia.pdf", bytes: sample.pdf(1) }]);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({
      error: "conflict",
      fields: { "files.1": "taken" },
      duplicateOf: first.id,
    });
    expect(storage.keys()).toHaveLength(1);
    expect(await db.select().from(documents)).toHaveLength(1);
  });

  it("a known photo among new ones: 409 on that one, and none of them stored", async () => {
    const first = await uploaded([{ name: "1.jpg", bytes: sample.jpeg(1) }]);
    const response = await upload([
      { name: "a.jpg", bytes: sample.jpeg(10) },
      { name: "b.jpg", bytes: sample.jpeg(1) },
      { name: "c.jpg", bytes: sample.jpeg(11) },
    ]);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "conflict",
      fields: { "files.2": "taken" },
      duplicateOf: first.id,
    });
    expect(storage.keys()).toHaveLength(1);
  });

  it("the same photo twice in one upload: 409 on the second", async () => {
    const response = await upload([
      { name: "a.jpg", bytes: sample.jpeg(1) },
      { name: "a-again.jpg", bytes: sample.jpeg(1) },
    ]);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "conflict",
      fields: { "files.2": "taken" },
    });
    expect(storage.keys()).toEqual([]);
  });

  it("every role may upload (spec section 6: everyone receives deliveries); nobody signed out", async () => {
    const as: Record<Role, string> = {
      counter: await signedInAs(app, auth, "counter"),
      office: cookie,
      owner: await signedInAsOwner(app, auth),
    };
    let n = 100;
    for (const [role, session] of Object.entries(as)) {
      const response = await upload(
        [{ name: "x.pdf", bytes: sample.pdf(n++) }],
        session,
      );
      expect(response.statusCode, role).toBe(201);
    }
    const signedOut = await upload(
      [{ name: "x.pdf", bytes: sample.pdf(n) }],
      "",
    );
    expect(signedOut.statusCode).toBe(401);
  });

  it("whatever bytes a photo holds, the file stored is those bytes, with their sha256 recorded", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 4096 }),
        async (body) => {
          const bytes = new Uint8Array([
            0x89,
            0x50,
            0x4e,
            0x47,
            0x0d,
            0x0a,
            0x1a,
            0x0a,
            ...body,
          ]);
          await db.execute(sql`truncate ${documents} cascade`);
          storage.clear();
          const document = await uploaded([{ name: "p.png", bytes }]);
          const [file] = await db
            .select()
            .from(documentFiles)
            .where(eq(documentFiles.documentId, document.id));
          expect(file!.sha256).toBe(sha256(bytes));
          expect(await storage.get(file!.storageKey)).toEqual(bytes);
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("two uploads of the same file at the same moment", () => {
  it("the one saved second answers 409, and the files it had just stored are removed", async () => {
    // A storage whose first put lets the other upload win: it saves the same file first.
    const racing = createMemoryStorage();
    const bytes = sample.pdf(42);
    let raced = false;
    const app2 = buildApp(config, {
      storage: {
        ...racing,
        async put(key, data, contentType) {
          await racing.put(key, data, contentType);
          if (raced) return;
          raced = true;
          const [winner] = await db
            .insert(documents)
            .values({ uploadedBy: (await db.select().from(users))[0]!.id })
            .returning();
          await db.insert(documentFiles).values({
            documentId: winner!.id,
            position: 1,
            kind: "pdf",
            contentType: "application/pdf",
            sizeBytes: bytes.length,
            sha256: sha256(bytes),
            storageKey: `documents/${winner!.id}/1.pdf`,
          });
        },
      },
    });
    const body = multipart([{ name: "a.pdf", bytes }]);
    const response = await app2.inject({
      method: "POST",
      url: "/api/documents",
      headers: { ...body.headers, cookie },
      payload: body.payload,
    });
    await app2.close();

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "conflict",
      fields: { files: "taken" },
    });
    expect(racing.keys()).toEqual([]);
    // Its transaction rolled back, the job it queued with it.
    expect(await queuedReads()).toEqual([]);
  });
});

describe("GET /api/documents", () => {
  it("newest first, filtered by status, a page at a time", async () => {
    const a = await uploaded([{ name: "a.pdf", bytes: sample.pdf(1) }]);
    const b = await uploaded([{ name: "b.pdf", bytes: sample.pdf(2) }]);
    const c = await uploaded([{ name: "c.pdf", bytes: sample.pdf(3) }]);
    await db
      .update(documents)
      .set({ status: "failed" })
      .where(eq(documents.id, b.id));

    const all = DocumentPage.parse((await read("/api/documents")).json());
    expect(all.items.map((d) => d.id)).toEqual([c.id, b.id, a.id]);
    expect(all.total).toBe(3);

    const failed = DocumentPage.parse(
      (await read("/api/documents?status=failed")).json(),
    );
    expect(failed.items.map((d) => d.id)).toEqual([b.id]);

    const second = DocumentPage.parse(
      (await read("/api/documents?pageSize=1&page=2")).json(),
    );
    expect(second).toMatchObject({ items: [{ id: b.id }], total: 3 });
  });

  it("refuses a status it doesn't know: 400", async () => {
    const response = await read("/api/documents?status=posted");
    expect(response.json()).toEqual({
      error: "invalid_input",
      fields: { status: "invalid" },
    });
  });
});

describe("GET /api/documents/:id", () => {
  it("the document with its files in order, each with a link that expires in 5 minutes", async () => {
    const created = await uploaded([
      { name: "1.jpg", bytes: sample.jpeg(1) },
      { name: "2.jpg", bytes: sample.jpeg(2) },
    ]);
    const before = Date.now();
    const document = Document.parse(
      (await read(`/api/documents/${created.id}`)).json(),
    );
    expect(document.files.map((f) => f.position)).toEqual([1, 2]);
    for (const file of document.files) {
      const expires = Date.parse(file.urlExpiresAt);
      expect(expires - before).toBeGreaterThan(4 * 60_000);
      expect(expires - before).toBeLessThanOrEqual(5 * 60_000 + 1000);
      expect(storage.signedKey(file.url)).toBeDefined();
    }
  });

  it("one that doesn't exist: 404", async () => {
    const response = await read(
      "/api/documents/0199a000-0000-7000-8000-000000000000",
    );
    expect(response.statusCode).toBe(404);
  });
});

describe("without storage configured", () => {
  const bare = buildApp(config);
  afterAll(() => bare.close());

  it("uploading and reading a document answer 503 storage_unavailable; the list still works", async () => {
    const as = await signedInAs(bare, auth, "counter");
    const body = multipart([{ name: "a.pdf", bytes: sample.pdf(1) }]);
    const posted = await bare.inject({
      method: "POST",
      url: "/api/documents",
      headers: { ...body.headers, cookie: as },
      payload: body.payload,
    });
    expect(posted.statusCode).toBe(503);
    expect(posted.json()).toEqual({ error: "storage_unavailable" });
    const one = await bare.inject({
      method: "GET",
      url: "/api/documents/0199a000-0000-7000-8000-000000000000",
      headers: { cookie: as },
    });
    expect(one.statusCode).toBe(503);
    const list = await bare.inject({
      method: "GET",
      url: "/api/documents",
      headers: { cookie: as },
    });
    expect(list.statusCode).toBe(200);
  });
});
