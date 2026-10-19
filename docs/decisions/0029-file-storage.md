# 0029. File storage: Scaleway, uploads through the API, downloads by short-lived links

- Status: Accepted
- Date: 2026-10-19

## Context

M6 brings supplier documents into the app (#102): a PDF or Facturae file, or one or several photos of a delivery note. Spec section 7 decided Scaleway Object Storage, EU region, with versioning on. Spec 11.3 proposed, as a default to try, signed links for uploading and downloading.

At about 300 documents a month (spec 11.1), a phone's photos are a few megabytes each.

## Decision

**Scaleway Object Storage, one private bucket per environment** (spec section 7), versioning on. The backups' bucket stays separate (decision 0014): its key can only upload, and the documents' keys can't touch it.

**Uploads go through the API,** as `multipart/form-data`, not straight from the browser to storage with a signed link. The API sees every file as it arrives, so in one request it can:
- check its kind from its bytes (packages/extract's `detectFormat`), and its size;
- hash it, and refuse a file already received, naming the document that has it;
- store the files, then save the rows in one audited transaction, removing the files again if that fails.

Direct uploads would need CORS on the bucket, a second "done" call from the browser, and the checks run only after the file is already stored.

**Downloads use links signed for 5 minutes,** made for each read of a document. The bucket is never public.

**Limits:** one PDF or Facturae file, or up to 10 photos (JPEG or PNG), each up to 20 MB (extraction's own limit, which a test keeps equal), and 60 MB a request.

**Storage keys say nothing about the contents:** `documents/<document id>/<position>.<extension>`.

**The S3 client is `aws4fetch`:** it signs requests and links for Node's own `fetch`, with no dependencies. Storage sits behind a small interface (put, get, signed link, delete), so tests use an in-memory one.

**Locally and in CI, `rclone serve s3` stands in for Scaleway** (`docker-compose.yml`'s `s3`), as it already does in the backup's test. Its keys are local-only.

**Storage is optional to start:** without the five `S3_*` variables, the API starts, logs that documents are off, and the document endpoints that need files answer 503 `storage_unavailable`. Staging and production get their buckets in #105.

## Alternatives considered

- **Direct uploads with signed links (spec 11.3's default):** they spare the API the bytes, which matters at much higher volumes than these. The cost is CORS, a second call, and checks after the fact.
- **AWS's own SDK:** many packages, and its recent default checksums trip up S3-compatible storage that isn't AWS's unless a setting turns them off.
- **MinIO as the local stand-in:** its free edition is now distributed as source only, and rclone was already in the repo.
- **Render's own object storage:** in early access only, and a second provider is needed anyway for the independent backup copy (spec section 7).
