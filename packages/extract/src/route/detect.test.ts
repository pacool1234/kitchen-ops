import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { detectFormat, type InputFormat } from "./detect";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);
const concat = (a: Uint8Array, b: Uint8Array) => {
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
};

// The first bytes of each format, as a file of that format starts.
const SIGNATURES: readonly [InputFormat, Uint8Array][] = [
  ["pdf", ascii("%PDF-1.7\n")],
  ["jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
  ["png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
  ["xml", ascii('<?xml version="1.0" encoding="UTF-8"?>')],
  ["heic", concat(bytes(0, 0, 0, 0x18), ascii("ftypheic"))],
];

describe("detectFormat: the format comes from the bytes, never from a file name", () => {
  it.each(SIGNATURES)("recognises %s", (format, signature) => {
    expect(detectFormat(signature)).toBe(format);
  });

  it("only the first bytes count: appending anything after a signature never changes the format", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SIGNATURES),
        fc.uint8Array({ maxLength: 2000 }),
        ([format, signature], rest) => {
          expect(detectFormat(concat(signature, rest))).toBe(format);
        },
      ),
    );
  });

  it("bytes with no known signature are unknown", () => {
    // Bytes that can't start any signature: not %, 0xFF, 0x89, a BOM, < or whitespace, and
    // without "ftyp" at offset 4.
    const starts = new Set([
      0x25, 0xff, 0x89, 0xef, 0x3c, 0x20, 0x09, 0x0a, 0x0d,
    ]);
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 2000 }), (input) => {
        fc.pre(!starts.has(input[0] ?? 0));
        fc.pre(
          new TextDecoder("latin1").decode(input.subarray(4, 8)) !== "ftyp",
        );
        fc.pre(!new TextDecoder("latin1").decode(input).includes("%PDF-"));
        expect(detectFormat(input)).toBe("unknown");
      }),
    );
    expect(detectFormat(new Uint8Array())).toBe("unknown");
  });

  it("a PDF may have up to 1024 bytes of junk before %PDF-, as readers accept", () => {
    const junk = new Uint8Array(1000).fill(0x41);
    expect(detectFormat(concat(junk, ascii("%PDF-1.4")))).toBe("pdf");
    const tooMuch = new Uint8Array(1100).fill(0x41);
    expect(detectFormat(concat(tooMuch, ascii("%PDF-1.4")))).toBe("unknown");
  });

  it("XML may start with a byte order mark and whitespace", () => {
    const bom = bytes(0xef, 0xbb, 0xbf);
    expect(detectFormat(concat(bom, ascii("\r\n  <Facturae/>")))).toBe("xml");
  });

  it("HEIC is recognised by its brand, so it can be refused with a clear message", () => {
    for (const brand of ["heic", "heix", "hevc", "mif1"]) {
      expect(
        detectFormat(concat(bytes(0, 0, 0, 0x18), ascii(`ftyp${brand}`))),
      ).toBe("heic");
    }
    // AVIF uses the same box, with its own brand: not HEIC.
    expect(detectFormat(concat(bytes(0, 0, 0, 0x18), ascii("ftypavif")))).toBe(
      "unknown",
    );
  });
});
