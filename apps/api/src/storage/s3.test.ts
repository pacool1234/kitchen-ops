import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testStorageConfig } from "../test/helpers";
import { createS3Storage } from "./s3";

// The S3 client (#102, decision 0029) against the local stand-in for Scaleway (docker-compose.yml's
// `s3`, and CI's): what's put can be read back, a signed link works without any key, and stops
// working once it has expired.

const storage = createS3Storage(testStorageConfig());
const key = () => `test/${randomUUID()}.bin`;
const bytes = (text: string) => new TextEncoder().encode(text);

describe("S3 storage", () => {
  it("puts a file and gets the same bytes back", async () => {
    const k = key();
    await storage.put(k, bytes("hola"), "text/plain");
    expect(await storage.get(k)).toEqual(bytes("hola"));
  });

  it("a signed link reads the file with no key, with the content type it was stored with", async () => {
    const k = key();
    await storage.put(k, bytes("%PDF-1.7"), "application/pdf");
    const { url, expiresAt } = await storage.signedUrl(k, 300);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(290_000);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      bytes("%PDF-1.7"),
    );
  });

  it("a signed link stops working once it has expired", async () => {
    const k = key();
    await storage.put(k, bytes("x"), "text/plain");
    const { url } = await storage.signedUrl(k, 1);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    // Refused: Scaleway and AWS answer 403, the local server 400.
    const { status } = await fetch(url);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it("a link that was tampered with doesn't work", async () => {
    const k = key();
    await storage.put(k, bytes("x"), "text/plain");
    const { url } = await storage.signedUrl(k, 300);
    const other = url.replace(
      encodeURIComponent(k.split("/")[1]!),
      "other.bin",
    );
    expect((await fetch(other)).status).toBe(403);
  });

  it("deletes a file", async () => {
    const k = key();
    await storage.put(k, bytes("x"), "text/plain");
    await storage.delete(k);
    await expect(storage.get(k)).rejects.toThrow(/404/);
  });
});
