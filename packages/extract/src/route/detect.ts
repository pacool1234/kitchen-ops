// What kind of file arrived (spec section 5, stage 2). Only the bytes count: a file name or an
// upload's declared type can be wrong, the signature at the start of the file can't.

export type InputFormat = "pdf" | "jpeg" | "png" | "xml" | "heic" | "unknown";

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const UTF8_BOM = [0xef, 0xbb, 0xbf];
const FTYP = [0x66, 0x74, 0x79, 0x70]; // "ftyp", at offset 4 in HEIC and AVIF files
/** Brands of HEIC photos, as iPhones save them. AVIF has its own ("avif"). */
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "mif1",
]);
/** Readers accept up to 1024 bytes before "%PDF-". */
const PDF_SEARCH_BYTES = 1024;

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0) {
  return signature.every((value, i) => bytes[at + i] === value);
}

function isXml(bytes: Uint8Array): boolean {
  let i = startsWith(bytes, UTF8_BOM) ? UTF8_BOM.length : 0;
  while ([0x20, 0x09, 0x0a, 0x0d].includes(bytes[i] ?? -1)) i++;
  return bytes[i] === 0x3c; // "<"
}

function brand(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes.subarray(8, 12));
}

export function detectFormat(bytes: Uint8Array): InputFormat {
  if (startsWith(bytes, PDF)) return "pdf";
  if (startsWith(bytes, JPEG)) return "jpeg";
  if (startsWith(bytes, PNG)) return "png";
  if (startsWith(bytes, FTYP, 4) && HEIC_BRANDS.has(brand(bytes))) {
    return "heic";
  }
  if (isXml(bytes)) return "xml";
  const end = Math.min(bytes.length, PDF_SEARCH_BYTES + PDF.length);
  for (let at = 1; at + PDF.length <= end; at++) {
    if (startsWith(bytes, PDF, at)) return "pdf";
  }
  return "unknown";
}
