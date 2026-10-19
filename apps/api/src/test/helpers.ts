import { createHmac } from "node:crypto";
import { inject } from "vitest";
import { type Config, loadConfig } from "../config";

/** A valid config for tests. The secret is built at runtime and is obviously not real. */
export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    APP_VERSION: "test-version",
    DATABASE_URL: inject("testDatabaseUrl"),
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://127.0.0.1:3000",
    LOG_LEVEL: "silent",
    ...env,
  });
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * The 6-digit code an authenticator app would show (RFC 6238: HMAC-SHA1, 30-second steps),
 * for the base32 secret in an otpauth:// URI.
 */
export function totpCode(base32Secret: string, time = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(base32Secret))
    .update(counter)
    .digest();
  const offset = hmac.readUInt8(hmac.length - 1) & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/**
 * The local stand-in for Scaleway (docker-compose.yml's `s3`, and CI's): the bucket and its
 * local-only keys, or TEST_S3_ENDPOINT's server.
 */
export function testStorageConfig() {
  return {
    endpoint: process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9000",
    region: "fr-par",
    bucket: "kitchen-ops-documents",
    accessKeyId: "local-only-key",
    secretAccessKey: "local-only-secret",
  };
}
