import {
  CLIENT_ROUTING,
  OpenRouterError,
  type ModelConfig,
  type OpenRouterClient,
  type Prompt,
} from "@kitchen-ops/extract";
import { Document, type ExtractedDocument } from "@kitchen-ops/shared";
import { asc, eq, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import {
  auditLog,
  documents,
  extractionAttempts,
  suppliers,
  users,
} from "../db/schema";
import { createMemoryStorage } from "../storage/memory";
import type { Storage } from "../storage/storage";
import { signedInAs } from "../test/auth";
import { syntheticCif } from "../test/catalogue";
import { multipart, photo, sample, type UploadFile } from "../test/documents";
import { testConfig } from "../test/helpers";
import { fakeDocument } from "./fake";
import { markFailed, today } from "./read";
import type { Reader } from "./reader";

// Reading documents in the background (#104): an upload queues a job, which reads the files with
// the model, checks the result and stores it for review. Errors are tried again, 3 tries in all,
// then the document is failed; a failed one can be read again from the app. Real pg-boss on the
// test database, in-memory storage, and a scripted client in place of OpenRouter: no network.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const storage = createMemoryStorage();
afterAll(close);

const model: ModelConfig = {
  id: "vendor/vision",
  structuredOutput: true,
  vision: true,
};
const prompt: Prompt = { version: "v1", text: "Extract the document." };
/** Tries again at once and looks for jobs often, so a test waits a second, not minutes. */
const FAST = {
  retryDelaySeconds: 0,
  retryBackoff: false,
  pollingIntervalSeconds: 0.5,
};

type Reply = ExtractedDocument | string | Error;

/** A client answering each call with the next reply, remembering each request. */
function scripted(...replies: Reply[]) {
  const requests: Record<string, unknown>[] = [];
  const client: OpenRouterClient = {
    complete: async (body) => {
      requests.push(structuredClone(body));
      const next = replies.shift();
      if (next === undefined) throw new Error("no more scripted replies");
      if (next instanceof Error) throw next;
      return {
        content: typeof next === "string" ? next : JSON.stringify(next),
        promptTokens: 1000,
        completionTokens: 200,
        // 400 millionths of a dollar.
        cost: 0.0004,
      };
    },
  };
  return { client, requests };
}

const open: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

/** An app that reads documents with this client, or none that reads them at all. */
function appReadingWith(
  client: OpenRouterClient | null,
  options: { storage?: Storage } = {},
) {
  const reader: Reader | null = client ? { client, model, prompt } : null;
  const app = buildApp(config, {
    storage: options.storage ?? storage,
    reader,
    jobs: FAST,
  });
  open.push(app);
  return app;
}

beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${documents}, ${suppliers}, verifications cascade`,
  );
  // Jobs left by other test files, for documents that no longer exist.
  await db.execute(sql`delete from pgboss.job`);
  storage.clear();
});

const SUPPLIER_TAX_ID = syntheticCif(7);

/** What the model reads off the photo: the fake model's document, from a known supplier. */
const read = (changes: Partial<ExtractedDocument> = {}): ExtractedDocument => ({
  ...fakeDocument(today(new Date())),
  supplier: { name: "Frutas del Huerto, S.L.", taxId: SUPPLIER_TAX_ID },
  number: "A-2026-0042",
  ...changes,
});

async function supplier() {
  const [row] = await db
    .insert(suppliers)
    .values({ name: "Frutas del Huerto, S.L.", taxId: SUPPLIER_TAX_ID })
    .returning();
  return row!;
}

/** One counter user's session for each app. */
const sessions = new WeakMap<object, Promise<string>>();
function signedIn(app: ReturnType<typeof appReadingWith>) {
  if (!sessions.has(app)) sessions.set(app, signedInAs(app, auth, "counter"));
  return sessions.get(app)!;
}

let next = 1;
async function upload(
  app: ReturnType<typeof appReadingWith>,
  files: readonly UploadFile[] = [{ name: "1.png", bytes: photo(next++) }],
) {
  const cookie = await signedIn(app);
  const body = multipart(files);
  const response = await app.inject({
    method: "POST",
    url: "/api/documents",
    headers: { ...body.headers, cookie },
    payload: body.payload,
  });
  expect(response.statusCode, response.body).toBe(201);
  return { document: Document.parse(response.json()), cookie };
}

const row = async (id: string) =>
  (await db.select().from(documents).where(eq(documents.id, id)))[0]!;

const attempts = (id: string) =>
  db
    .select()
    .from(extractionAttempts)
    .where(eq(extractionAttempts.documentId, id))
    .orderBy(asc(extractionAttempts.createdAt));

/** Waits until the document is read or failed. */
async function settled(id: string, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = await row(id);
    if (found.status === "ready_for_review" || found.status === "failed") {
      return found;
    }
    if (Date.now() > until) {
      throw new Error(`still ${found.status} after ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const getDocument = async (
  app: ReturnType<typeof appReadingWith>,
  id: string,
  cookie: string,
) =>
  Document.parse(
    (
      await app.inject({
        method: "GET",
        url: `/api/documents/${id}`,
        headers: { cookie },
      })
    ).json(),
  );

describe("an uploaded document is read in the background", () => {
  it("becomes ready for review with its draft, supplier, number, date, type and cost", async () => {
    const known = await supplier();
    const { client, requests } = scripted(read());
    const app = appReadingWith(client);
    const { document, cookie } = await upload(app);
    expect(document.status).toBe("queued");

    const done = await settled(document.id);
    expect(done).toMatchObject({
      status: "ready_for_review",
      type: "delivery-note",
      supplierId: known.id,
      number: "A-2026-0042",
      date: today(new Date()),
      draft: read(),
      checkFailures: [],
      reviewNote: null,
      failureReason: null,
    });
    expect(await getDocument(app, document.id, cookie)).toMatchObject({
      status: "ready_for_review",
      supplier: { id: known.id, name: "Frutas del Huerto, S.L." },
      failureReason: null,
      costMicroUsd: 400,
    });
    expect(await attempts(document.id)).toEqual([
      expect.objectContaining({
        try: 1,
        outcome: "extracted",
        failureReason: null,
        model: "vendor/vision",
        promptVersion: "v1",
        modelCalls: 1,
        promptTokens: 1000,
        completionTokens: 200,
        costMicroUsd: 400,
      }),
    ]);
    // A client's document: always sent with restricted routing.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.provider).toMatchObject(CLIENT_ROUTING);
  });

  it("is ready for review even when checks fail, with the failures kept; no supplier if none matches", async () => {
    const wrongTotal = read();
    const app = appReadingWith(
      scripted({
        ...wrongTotal,
        totals: { ...wrongTotal.totals!, total: "1.00" },
      }).client,
    );
    const { document } = await upload(app);
    const done = await settled(document.id);
    expect(done.status).toBe("ready_for_review");
    expect(done.supplierId).toBeNull();
    expect(done.checkFailures?.map((f) => f.check)).toContain("total");
  });

  it("a number already received from that supplier shows as a duplicate", async () => {
    await supplier();
    const app = appReadingWith(scripted(read(), read()).client);
    const first = await upload(app);
    await settled(first.document.id);
    const second = await upload(app);
    const done = await settled(second.document.id);
    expect(done.status).toBe("ready_for_review");
    expect(done.checkFailures).toEqual([
      expect.objectContaining({ check: "duplicate", path: "number" }),
    ]);
    // The first one isn't a duplicate of itself.
    expect((await row(first.document.id)).checkFailures).toEqual([]);
  });

  it("an answer that doesn't match the schema, even after its own retry, is ready for review with a note and no draft", async () => {
    const app = appReadingWith(scripted("not json", "still not json").client);
    const { document } = await upload(app);
    const done = await settled(document.id);
    expect(done).toMatchObject({
      status: "ready_for_review",
      draft: null,
      reviewNote: "the output was invalid twice",
      failureReason: null,
    });
    expect(await attempts(document.id)).toEqual([
      expect.objectContaining({
        outcome: "needs_review",
        modelCalls: 2,
        costMicroUsd: 800,
      }),
    ]);
  });
});

describe("errors are tried again, 3 tries in all", () => {
  it("an error, then an answer: ready for review on the second try, both recorded and paid for", async () => {
    const app = appReadingWith(
      scripted(new OpenRouterError("OpenRouter answered 503", 503), read())
        .client,
    );
    const { document, cookie } = await upload(app);
    expect((await settled(document.id)).status).toBe("ready_for_review");
    expect(
      (await attempts(document.id)).map((a) => [
        a.try,
        a.outcome,
        a.failureReason,
      ]),
    ).toEqual([
      [1, "failed", "model_error"],
      [2, "extracted", null],
    ]);
    expect((await getDocument(app, document.id, cookie)).costMicroUsd).toBe(
      400,
    );
  });

  it("three errors: failed, with a reason code and nothing of the document or the error's text", async () => {
    // What a provider might say: words from the document, and something that looks like a key.
    const words = "Tomate pera from sk-or-v1-0000000000000000";
    const app = appReadingWith(
      scripted(
        new OpenRouterError(`OpenRouter answered 500: ${words}`, 500),
        new OpenRouterError(`OpenRouter answered 500: ${words}`, 500),
        new OpenRouterError(`OpenRouter answered 500: ${words}`, 500),
      ).client,
    );
    const { document, cookie } = await upload(app);
    const done = await settled(document.id);
    expect(done).toMatchObject({
      status: "failed",
      failureReason: "model_error",
    });
    const tries = await attempts(document.id);
    expect(tries.map((a) => [a.try, a.outcome, a.failureReason])).toEqual([
      [1, "failed", "model_error"],
      [2, "failed", "model_error"],
      [3, "failed", "model_error"],
    ]);
    const stored = JSON.stringify([done, tries]);
    expect(stored).not.toContain("Tomate");
    expect(stored).not.toContain("sk-or-v1");
    expect(await getDocument(app, document.id, cookie)).toMatchObject({
      status: "failed",
      failureReason: "model_error",
    });
  });

  it("the network failing every time: failed, model_unreachable", async () => {
    const offline = () => new TypeError("fetch failed");
    const app = appReadingWith(
      scripted(offline(), offline(), offline()).client,
    );
    const { document } = await upload(app);
    expect(await settled(document.id)).toMatchObject({
      status: "failed",
      failureReason: "model_unreachable",
    });
  });

  it("storage that can't give the files back: tried 3 times, then failed, storage_error, without calling the model", async () => {
    const broken: Storage = {
      ...storage,
      get: async () => {
        throw new Error("storage is down");
      },
    };
    const { client, requests } = scripted();
    const app = appReadingWith(client, { storage: broken });
    const { document } = await upload(app);
    expect(await settled(document.id)).toMatchObject({
      status: "failed",
      failureReason: "storage_error",
    });
    expect(await attempts(document.id)).toHaveLength(3);
    expect(requests).toEqual([]);
  });

  it("a photo it can't read is failed at once, unreadable: trying again wouldn't help", async () => {
    const { client, requests } = scripted();
    const app = appReadingWith(client);
    const { document } = await upload(app, [
      { name: "1.png", bytes: photo(next++) },
      { name: "2.png", bytes: sample.png(next++) },
    ]);
    expect(await settled(document.id)).toMatchObject({
      status: "failed",
      failureReason: "unreadable",
    });
    expect(await attempts(document.id)).toEqual([
      expect.objectContaining({
        try: 1,
        outcome: "rejected",
        failureReason: "unreadable",
        modelCalls: 0,
      }),
    ]);
    expect(requests).toEqual([]);
  });

  it("however many tries fail, the cost is the sum of the tries and the status follows", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 3 }), async (failures) => {
        await db.execute(sql`truncate ${users}, ${documents} cascade`);
        const replies: Reply[] = [
          ...Array.from(
            { length: failures },
            () => new OpenRouterError("OpenRouter answered 502", 502),
          ),
          read(),
        ];
        const app = appReadingWith(scripted(...replies).client);
        const { document, cookie } = await upload(app);
        const done = await settled(document.id);
        expect(done.status).toBe(failures < 3 ? "ready_for_review" : "failed");
        const tries = await attempts(document.id);
        expect(tries).toHaveLength(Math.min(failures + 1, 3));
        const sum = tries.reduce((n, a) => n + (a.costMicroUsd ?? 0), 0);
        expect((await getDocument(app, document.id, cookie)).costMicroUsd).toBe(
          sum,
        );
        await app.close();
      }),
      { numRuns: 6 },
    );
  }, 60_000);
});

describe("reading stopped before it finished", () => {
  it("a job that ran out of tries without recording why: failed, interrupted", async () => {
    const app = appReadingWith(null);
    const { document } = await upload(app);
    await markFailed(db, document.id, "a-job-that-recorded-nothing");
    expect(await row(document.id)).toMatchObject({
      status: "failed",
      failureReason: "interrupted",
    });
  });

  it("a document that isn't waiting any more is left as it is", async () => {
    const app = appReadingWith(null);
    const { document } = await upload(app);
    await db
      .update(documents)
      .set({ status: "ready_for_review" })
      .where(eq(documents.id, document.id));
    await markFailed(db, document.id, "any-job");
    expect((await row(document.id)).status).toBe("ready_for_review");
  });
});

describe("jobs survive a restart", () => {
  it("a document uploaded while nothing reads is read once an API that reads starts", async () => {
    const before = appReadingWith(null);
    const { document } = await upload(before);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect((await row(document.id)).status).toBe("queued");
    await before.close();

    const after = appReadingWith(scripted(read()).client);
    await after.ready();
    expect((await settled(document.id)).status).toBe("ready_for_review");
  });
});

describe("POST /api/documents/:id/retry", () => {
  async function failedDocument() {
    const fail = () => new OpenRouterError("OpenRouter answered 503", 503);
    const app = appReadingWith(scripted(fail(), fail(), fail(), read()).client);
    const uploaded = await upload(app);
    expect((await settled(uploaded.document.id)).status).toBe("failed");
    return { app, ...uploaded };
  }

  const retry = (
    app: ReturnType<typeof appReadingWith>,
    id: string,
    cookie: string,
  ) =>
    app.inject({
      method: "POST",
      url: `/api/documents/${id}/retry`,
      headers: { cookie },
    });

  it("queues a failed document again, audited, and it's read", async () => {
    const { app, document, cookie } = await failedDocument();
    const response = await retry(app, document.id, cookie);
    expect(response.statusCode, response.body).toBe(200);
    expect(Document.parse(response.json())).toMatchObject({
      status: "queued",
      failureReason: null,
    });
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, "update")),
    ).toEqual([
      expect.objectContaining({
        entityType: "document",
        entityId: document.id,
        documentId: document.id,
        requestId: response.headers["x-request-id"],
        changes: {
          status: { before: "failed", after: "queued" },
          failureReason: { before: "model_error", after: null },
        },
      }),
    ]);
    expect((await settled(document.id)).status).toBe("ready_for_review");
    // The new job's try is a try 1 again, after the first job's three.
    expect((await attempts(document.id)).map((a) => a.try)).toEqual([
      1, 2, 3, 1,
    ]);
  });

  it.each(["queued", "reading", "ready_for_review"] as const)(
    "answers 409 not_failed for a document that's %s, and records nothing",
    async (status) => {
      const app = appReadingWith(null);
      const { document, cookie } = await upload(app);
      await db
        .update(documents)
        .set({ status })
        .where(eq(documents.id, document.id));
      const response = await retry(app, document.id, cookie);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "not_failed" });
      expect((await row(document.id)).status).toBe(status);
      expect(
        await db.select().from(auditLog).where(eq(auditLog.action, "update")),
      ).toEqual([]);
    },
  );

  it("one that doesn't exist: 404", async () => {
    const app = appReadingWith(null);
    const cookie = await signedIn(app);
    const response = await retry(
      app,
      "0199a000-0000-7000-8000-000000000000",
      cookie,
    );
    expect(response.statusCode).toBe(404);
  });
});
