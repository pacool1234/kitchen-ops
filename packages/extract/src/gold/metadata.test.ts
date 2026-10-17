import { describe, expect, it } from "vitest";
import { plainImage } from "../route/testing";
import { fileMetadata } from "./metadata";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );

/** A JPEG marker segment: FF, the marker, a two-byte length, then the body. */
const segment = (marker: number, body: string) =>
  bytes([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff], body);
const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
/** Start of scan, a little image data, end of image. */
const scan = bytes(
  [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0],
  [0x12, 0x34, 0xff, 0x00, 0x56],
  EOI,
);
const jpeg = (...segments: Uint8Array[]) =>
  new Uint8Array([...SOI, ...segments.flatMap((s) => [...s]), ...scan]);

/** A PNG chunk; the CRC isn't checked, so zeros. */
const chunk = (type: string, data = "") =>
  bytes([0, 0, data.length >> 8, data.length & 0xff], type, data, [0, 0, 0, 0]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (...chunks: Uint8Array[]) =>
  new Uint8Array([
    ...PNG_SIGNATURE,
    ...chunks.flatMap((c) => [...c]),
    ...chunk("IEND"),
  ]);

describe("fileMetadata: what a gold source file carries besides the document", () => {
  it("a JPEG with only JFIF, a colour profile and Adobe's colour marker carries nothing", () => {
    expect(
      fileMetadata(
        jpeg(
          segment(0xe0, "JFIF\0\x01\x01"),
          segment(0xe2, "ICC_PROFILE\0..."),
          segment(0xee, "Adobe\0..."),
        ),
      ),
    ).toEqual([]);
  });

  it("a JPEG with EXIF (where a phone puts location and camera), XMP or a comment", () => {
    expect(fileMetadata(jpeg(segment(0xe1, "Exif\0\0MM")))).toEqual([
      "JPEG APP1 segment (Exif)",
    ]);
    expect(
      fileMetadata(jpeg(segment(0xe1, "http://ns.adobe.com/xap/1.0/\0<x"))),
    ).toEqual(["JPEG APP1 segment (http://ns.adobe.com/xap/1.0/)"]);
    expect(fileMetadata(jpeg(segment(0xfe, "taken by")))).toEqual([
      "JPEG comment",
    ]);
  });

  it("a JPEG with a second image inside it, as phones append for HDR", () => {
    const withSecond = new Uint8Array([
      ...jpeg(segment(0xe0, "JFIF\0")),
      ...jpeg(segment(0xe0, "JFIF\0")),
    ]);
    expect(fileMetadata(withSecond)).toEqual([
      "data after the end of the JPEG image",
    ]);
  });

  it("the real images the tests make carry nothing", async () => {
    expect(fileMetadata(await plainImage("jpeg"))).toEqual([]);
    expect(fileMetadata(await plainImage("png"))).toEqual([]);
  });

  it("a PNG with EXIF or text chunks", () => {
    expect(fileMetadata(png(chunk("IHDR", "0123456789abc")))).toEqual([]);
    expect(
      fileMetadata(png(chunk("IHDR", "0123456789abc"), chunk("eXIf", "MM"))),
    ).toEqual(["PNG eXIf chunk"]);
    expect(
      fileMetadata(
        png(chunk("IHDR", "0123456789abc"), chunk("tEXt", "Author\0x")),
      ),
    ).toEqual(["PNG tEXt chunk"]);
  });

  it("any other file (a PDF with a photo inside) with EXIF or XMP anywhere in it", () => {
    expect(fileMetadata(bytes("%PDF-1.7 ... stream"))).toEqual([]);
    expect(
      fileMetadata(bytes("%PDF-1.7 ", [0xff, 0xe1], "..Exif\0\0MM")),
    ).toEqual(["EXIF"]);
    expect(fileMetadata(bytes("%PDF-1.7 <x:xmpmeta xmlns:x=..."))).toEqual([
      "XMP",
    ]);
  });
});
