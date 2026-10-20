import { UPLOAD_LIMITS } from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkChosen, kindOf } from "./upload";

// The files chosen to upload, checked in the browser before anything is sent (#106): the same
// rules and field codes as the API's (apps/api/src/documents/upload.ts), so one message shows
// either way. The API still decides, by each file's bytes.

const file = (name: string, type: string, size = 1000) => ({
  name,
  type,
  size,
});
const photo = (n = 1) => file(`foto-${n}.jpg`, "image/jpeg");
const pdf = file("albaran.pdf", "application/pdf");
const xml = file("factura.xsig", "text/xml");

describe("kindOf: what a chosen file looks like, by what the browser says and its name", () => {
  it("JPEG and PNG photos, a PDF, a Facturae XML; anything else, HEIC included, isn't accepted", () => {
    expect(kindOf(photo())).toBe("image");
    expect(kindOf(file("a.png", "image/png"))).toBe("image");
    expect(kindOf(pdf)).toBe("pdf");
    expect(kindOf(file("f.xml", "application/xml"))).toBe("xml");
    expect(kindOf(xml)).toBe("xml");
    // Browsers often give no type for a Facturae file: its name says it.
    expect(kindOf(file("factura.xsig", ""))).toBe("xml");
    expect(kindOf(file("FACTURA.XML", ""))).toBe("xml");
    expect(kindOf(file("albaran.PDF", ""))).toBe("pdf");
    expect(kindOf(file("IMG_0001.HEIC", "image/heic"))).toBeNull();
    expect(kindOf(file("notes.txt", "text/plain"))).toBeNull();
  });
});

describe("checkChosen: the API's rules, by field, before sending", () => {
  it("nothing chosen: files are required", () => {
    expect(checkChosen([])).toEqual({ files: "required" });
  });

  it("one PDF, one XML, or 1 to 10 photos: nothing to say", () => {
    expect(checkChosen([pdf])).toEqual({});
    expect(checkChosen([xml])).toEqual({});
    expect(
      checkChosen(
        Array.from({ length: UPLOAD_LIMITS.maxPhotos }, (_, i) => photo(i)),
      ),
    ).toEqual({});
  });

  it("each file's own problem, by its position from 1, as the API numbers them", () => {
    expect(
      checkChosen([
        photo(1),
        file("big.jpg", "image/jpeg", UPLOAD_LIMITS.maxFileBytes + 1),
        file("IMG.HEIC", "image/heic"),
      ]),
    ).toEqual({ "files.2": "too_big", "files.3": "unsupported_type" });
  });

  it("photos each small enough, but too big together for one upload: too big as a whole", () => {
    const large = (n: number) =>
      file(`${n}.jpg`, "image/jpeg", UPLOAD_LIMITS.maxFileBytes - 1);
    const fitting = Math.floor(
      UPLOAD_LIMITS.maxRequestBytes / (UPLOAD_LIMITS.maxFileBytes - 1),
    );
    expect(
      checkChosen(Array.from({ length: fitting }, (_, i) => large(i))),
    ).toEqual({});
    expect(
      checkChosen(Array.from({ length: fitting + 1 }, (_, i) => large(i))),
    ).toEqual({ files: "too_big" });
  });

  it("a PDF or an XML goes alone", () => {
    expect(checkChosen([pdf, photo()])).toEqual({ files: "mixed_kinds" });
    expect(checkChosen([pdf, pdf])).toEqual({ files: "mixed_kinds" });
    expect(checkChosen([photo(), xml])).toEqual({ files: "mixed_kinds" });
  });

  it("any number of photos: more than 10 are too many, and 10 or fewer of a fine size pass", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (count) => {
        const photos = Array.from({ length: count }, (_, i) => photo(i));
        expect(checkChosen(photos)).toEqual(
          count > UPLOAD_LIMITS.maxPhotos ? { files: "too_many" } : {},
        );
      }),
    );
  });
});
