import { randomUUID } from "node:crypto";
import { StorageError, type Storage } from "./storage";

// Storage held in memory, for the API's tests (#102). Its links are made up: `memory://` with a
// one-time token, which `signedKey` checks the way a storage server checks a signature.

export interface MemoryStorage extends Storage {
  /** Every key stored, in the order they were first put. */
  keys(): string[];
  /** The key a link reads, if the link is one this storage made and hasn't expired. */
  signedKey(url: string): string | undefined;
  clear(): void;
}

export function createMemoryStorage(): MemoryStorage {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const links = new Map<string, { key: string; expires: number }>();
  return {
    async put(key, bytes, contentType) {
      files.set(key, { bytes: new Uint8Array(bytes), contentType });
    },
    async get(key) {
      const file = files.get(key);
      if (!file) throw new StorageError(`GET ${key}: 404`);
      return new Uint8Array(file.bytes);
    },
    async signedUrl(key, seconds) {
      const token = randomUUID();
      const expires = Date.now() + seconds * 1000;
      links.set(token, { key, expires });
      return {
        url: `memory://storage/${encodeURIComponent(key)}?token=${token}`,
        expiresAt: new Date(expires).toISOString(),
      };
    },
    async delete(key) {
      files.delete(key);
    },
    keys: () => [...files.keys()],
    signedKey(url) {
      const token = new URL(url).searchParams.get("token") ?? "";
      const link = links.get(token);
      return link && link.expires > Date.now() && files.has(link.key)
        ? link.key
        : undefined;
    },
    clear() {
      files.clear();
      links.clear();
    },
  };
}
