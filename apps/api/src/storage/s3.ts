import { AwsClient } from "aws4fetch";
import { StorageError, type SignedUrl, type Storage } from "./storage";

// Storage over the S3 API (decision 0029), signed with aws4fetch on Node's own fetch. Addresses
// are path-style (<endpoint>/<bucket>/<key>), which Scaleway and the local server both accept.

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Each part of a key encoded on its own: its slashes stay slashes. */
const encodeKey = (key: string) =>
  key.split("/").map(encodeURIComponent).join("/");

export function createS3Storage(config: S3Config): Storage {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
  });
  const base = config.endpoint.replace(/\/+$/, "");
  const urlOf = (key: string) => `${base}/${config.bucket}/${encodeKey(key)}`;

  async function send(key: string, init: RequestInit): Promise<Response> {
    const response = await client.fetch(urlOf(key), init);
    if (!response.ok) {
      // Never the key's contents or the credentials: only what was asked and the status.
      throw new StorageError(
        `${init.method ?? "GET"} ${key}: ${response.status}`,
      );
    }
    return response;
  }

  return {
    async put(key, bytes, contentType) {
      await send(key, {
        method: "PUT",
        body: bytes,
        headers: { "content-type": contentType },
      });
    },

    async get(key) {
      const response = await send(key, { method: "GET" });
      return new Uint8Array(await response.arrayBuffer());
    },

    async signedUrl(key, seconds): Promise<SignedUrl> {
      const now = new Date();
      const url = new URL(urlOf(key));
      url.searchParams.set("X-Amz-Expires", String(seconds));
      const signed = await client.sign(url.toString(), {
        method: "GET",
        aws: {
          signQuery: true,
          datetime: now.toISOString().replace(/[:-]|\.\d{3}/g, ""),
        },
      });
      return {
        url: signed.url,
        expiresAt: new Date(now.getTime() + seconds * 1000).toISOString(),
      };
    },

    async delete(key) {
      const response = await client.fetch(urlOf(key), { method: "DELETE" });
      // S3 answers 204 whether or not there was a file.
      if (!response.ok && response.status !== 404) {
        throw new StorageError(`DELETE ${key}: ${response.status}`);
      }
    },
  };
}
