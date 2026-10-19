import { Document } from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { documents, users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { multipart, sample } from "../test/documents";
import { testConfig, testStorageConfig } from "../test/helpers";

// The whole way through (#102): the API configured by its S3_* variables, an upload stored on
// the local S3 server, and the link the API answers with reading the very bytes sent.

const s3 = testStorageConfig();
const config = testConfig({
  S3_ENDPOINT: s3.endpoint,
  S3_REGION: s3.region,
  S3_BUCKET: s3.bucket,
  S3_ACCESS_KEY_ID: s3.accessKeyId,
  S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
});
const { db, close } = createDb(config.DATABASE_URL);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

describe("an upload through the API, into the local S3 server", () => {
  it("is read back, byte for byte, through the link the API answers with", async () => {
    await db.execute(
      sql`truncate ${users}, ${documents}, verifications cascade`,
    );
    const cookie = await signedInAs(app, createAuth(db, config), "counter");
    // Unique on every run: the local server keeps its files between runs.
    const bytes = sample.jpeg(Date.now());
    const body = multipart([{ name: "foto.jpg", bytes }]);
    const response = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: { ...body.headers, cookie },
      payload: body.payload,
    });
    expect(response.statusCode, response.body).toBe(201);
    const [file] = Document.parse(response.json()).files;

    const download = await fetch(file!.url);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  });
});
