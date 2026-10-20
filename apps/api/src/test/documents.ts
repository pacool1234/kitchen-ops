import { randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

// Uploading documents in tests (#102): sample files, recognised by their first bytes as the API
// recognises them, and a multipart body for app.inject.

const text = (value: string) => new TextEncoder().encode(value);
const join = (...parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
};

/** A file of each kind, different for each `n`, so its sha256 is its own. */
export const sample = {
  pdf: (n: number) => text(`%PDF-1.7\n% sample ${n}\n%%EOF\n`),
  xml: (n: number) =>
    text(
      `<?xml version="1.0" encoding="UTF-8"?>\n<fe:Facturae><!-- ${n} --></fe:Facturae>\n`,
    ),
  png: (n: number) =>
    join(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      text(`png ${n}`),
    ),
  jpeg: (n: number) =>
    join(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), text(`jpeg ${n}`)),
  /** An iPhone photo: extraction can't read it yet. */
  heic: (n: number) =>
    join(new Uint8Array([0, 0, 0, 0x18]), text(`ftypheic\0\0\0\0heic ${n}`)),
  /** A PDF of exactly `size` bytes: its start, then spaces. */
  pdfOfSize: (size: number) => {
    const bytes = new Uint8Array(size).fill(0x20);
    bytes.set(text("%PDF-1.7\n"));
    return bytes;
  },
  /** Neither a PDF, XML nor a photo, whatever its name says. */
  plainText: (n: number) => text(`just some notes ${n}`),
};

/** One PNG chunk: its length, type, data and CRC (the PNG specification, section 5.3). */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  const view = new DataView(head.buffer);
  view.setUint32(0, data.length);
  head.set(text(type), 4);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, crc32(join(text(type), data)));
  return join(head, data, tail);
}

/**
 * A real photo, which extraction can decode, unlike `sample.png`: a grey PNG `n` + 1 pixels wide
 * and 1 high, so each `n` is a file of its own (#104). `comment`, if given, goes in a text chunk,
 * which a viewer ignores: a marker for the fake model (#119).
 */
export function photo(n: number, comment?: string): Uint8Array {
  const width = n + 1;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, 1);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits a channel, RGB, no interlacing
  // One row: filter type 0, then each pixel's red, green and blue.
  const row = new Uint8Array(1 + 3 * width).fill(0x80);
  row[0] = 0;
  return join(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    ...(comment === undefined
      ? []
      : [pngChunk("tEXt", text(`Comment\0${comment}`))]),
    pngChunk("IDAT", new Uint8Array(deflateSync(row))),
    pngChunk("IEND", new Uint8Array()),
  );
}

export interface UploadFile {
  name: string;
  bytes: Uint8Array;
  /** What the browser says it is; the API goes by the bytes instead. */
  type?: string;
}

/** A multipart/form-data body with each file as a `files` part, in order. */
export function multipart(files: readonly UploadFile[], field = "files") {
  const boundary = `----kitchen-ops-${randomUUID()}`;
  const parts = files.flatMap((file) => [
    text(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${file.name}"\r\n` +
        `Content-Type: ${file.type ?? "application/octet-stream"}\r\n\r\n`,
    ),
    file.bytes,
    text("\r\n"),
  ]);
  return {
    payload: Buffer.from(join(...parts, text(`--${boundary}--\r\n`))),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}
