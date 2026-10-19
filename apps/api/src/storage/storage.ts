// Object storage for documents' files (#102, decision 0029): Scaleway in staging and production,
// the local `s3` service in development and CI, and an in-memory stand-in in most tests. The API
// only ever needs these four things of it.

/** A short-lived link to a file, and when it stops working. */
export interface SignedUrl {
  url: string;
  /** ISO 8601. */
  expiresAt: string;
}

export interface Storage {
  /** Stores `bytes` at `key`, replacing what was there. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The bytes at `key`. Throws if there are none. */
  get(key: string): Promise<Uint8Array>;
  /** A link that reads the file without a key, for `seconds`. */
  signedUrl(key: string, seconds: number): Promise<SignedUrl>;
  /** Removes the file at `key`; nothing happens if there's none. */
  delete(key: string): Promise<void>;
}

/** Thrown when storage answers something other than success. */
export class StorageError extends Error {
  override name = "StorageError";
}
