// What a gold source file carries besides the document. The repository is public, and a phone
// photo's EXIF holds where and with what it was taken, so the gold set test refuses any of it.
// JPEGs and PNGs are read segment by segment; any other file (a PDF with photos inside) is searched
// for EXIF and XMP signatures.

/** JPEG application segments that only describe the image itself, by marker and identifier. */
const HARMLESS_JPEG_SEGMENTS: Readonly<Record<number, readonly string[]>> = {
  0xe0: ["JFIF", "JFXX"],
  0xe2: ["ICC_PROFILE"], // the colour profile
  0xee: ["Adobe"], // how the colours are encoded
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** PNG chunks holding EXIF or free text (author, software, comments). */
const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);

const ascii = (bytes: Uint8Array) =>
  String.fromCharCode(...bytes).replace(/[^\x20-\x7e]/g, "");

/** A JPEG segment's identifier: the text before its first zero byte. */
function identifier(body: Uint8Array): string {
  const end = body.indexOf(0);
  return ascii(body.subarray(0, Math.min(end < 0 ? 40 : end, 40)));
}

function jpegMetadata(bytes: Uint8Array): string[] {
  const found: string[] = [];
  let i = 2;
  let end: number | null = null;
  while (i + 1 < bytes.length && end === null) {
    if (bytes[i] !== 0xff) break; // not a marker: a broken file, for routing to report
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
    } else if (marker === 0xd9) {
      end = i + 2;
    } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
    } else {
      const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
      const body = bytes.subarray(i + 4, i + 2 + length);
      if (marker >= 0xe0 && marker <= 0xef) {
        const id = identifier(body);
        if (!HARMLESS_JPEG_SEGMENTS[marker]?.includes(id)) {
          found.push(`JPEG APP${marker - 0xe0} segment (${id})`);
        }
      } else if (marker === 0xfe) {
        found.push("JPEG comment");
      }
      i += 2 + length;
      if (marker === 0xda) {
        // Image data follows, until the next marker: an FF not followed by 00 (an escaped FF)
        // or a restart marker.
        while (
          i + 1 < bytes.length &&
          !(
            bytes[i] === 0xff &&
            bytes[i + 1] !== 0x00 &&
            !(bytes[i + 1]! >= 0xd0 && bytes[i + 1]! <= 0xd7)
          )
        ) {
          i += 1;
        }
      }
    }
  }
  if (end !== null && bytes.subarray(end).some((byte) => byte !== 0)) {
    found.push("data after the end of the JPEG image");
  }
  return found;
}

function pngMetadata(bytes: Uint8Array): string[] {
  const found: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = PNG_SIGNATURE.length;
  while (i + 8 <= bytes.length) {
    const length = view.getUint32(i);
    const type = ascii(bytes.subarray(i + 4, i + 8));
    if (PNG_METADATA_CHUNKS.has(type)) found.push(`PNG ${type} chunk`);
    if (type === "IEND") break;
    i += 12 + length;
  }
  return found;
}

const contains = (bytes: Uint8Array, signature: string) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(
    signature,
    0,
    "latin1",
  );

/** What the file carries besides the document, as short descriptions; empty if nothing. */
export function fileMetadata(bytes: Uint8Array): string[] {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegMetadata(bytes);
  if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    return pngMetadata(bytes);
  }
  return [
    ...(contains(bytes, "Exif\0\0") ? ["EXIF"] : []),
    ...(contains(bytes, "<x:xmpmeta") ? ["XMP"] : []),
  ];
}
