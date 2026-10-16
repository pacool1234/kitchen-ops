import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { MAX_IMAGE_BYTES, MAX_IMAGE_LONG_SIDE, prepareImage } from "./image";

type Format = "jpeg" | "png";

/** A synthetic image: flat colour, or noise, which compresses badly and makes large files. */
async function image(
  width: number,
  height: number,
  format: Format,
  { noise = false, seed = 1 } = {},
): Promise<Uint8Array> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (noise) {
    const pixels = context.createImageData(width, height);
    let state = seed >>> 0;
    for (let i = 0; i < pixels.data.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      pixels.data[i] = i % 4 === 3 ? 255 : state >>> 24;
    }
    context.putImageData(pixels, 0, 0);
  } else {
    context.fillStyle = "#f4f1ea";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#222";
    context.fillRect(width / 10, height / 10, width / 2, height / 20);
  }
  return new Uint8Array(
    format === "png"
      ? await canvas.encode("png")
      : await canvas.encode("jpeg", 90),
  );
}

/** The bytes and MIME type inside a data URL. */
function decode(dataUrl: string): { type: string; bytes: Uint8Array } {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl,
  );
  if (!match) throw new Error("not a base64 image data URL");
  return {
    type: match[1]!,
    bytes: new Uint8Array(Buffer.from(match[2]!, "base64")),
  };
}

describe("prepareImage: an image as a data URL a vision model accepts", () => {
  it("the limit is what Anthropic accepts per image: 3.75 MB, which is 5 MB in base64", () => {
    expect(MAX_IMAGE_BYTES).toBe(3_932_160);
    expect(Math.ceil(MAX_IMAGE_BYTES / 3) * 4).toBe(5 * 1024 * 1024);
    expect(MAX_IMAGE_LONG_SIDE).toBe(2000);
  });

  it.each(["jpeg", "png"] as const)(
    "a %s within the limits is sent byte for byte, with its own type",
    async (format) => {
      const original = await image(1200, 1600, format);
      const prepared = await prepareImage(original, format);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.resized).toBe(false);
      expect(decode(prepared.dataUrl)).toEqual({
        type: `image/${format}`,
        bytes: original,
      });
    },
  );

  it("a photo larger than 2000 pixels is scaled down to 2000 on its long side, keeping its shape", async () => {
    const prepared = await prepareImage(
      await image(3000, 4000, "jpeg"),
      "jpeg",
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.resized).toBe(true);
    const sent = decode(prepared.dataUrl);
    expect(sent.type).toBe("image/jpeg");
    const scaled = await loadImage(Buffer.from(sent.bytes));
    expect(scaled.height).toBe(2000);
    expect(scaled.width).toBe(1500);
  });

  it("no image over the limits is ever sent, and one within them is never changed", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 1, max: 3000 }),
        fc.constantFrom<Format>("jpeg", "png"),
        fc.boolean(),
        fc.integer(),
        async (width, height, format, noise, seed) => {
          const original = await image(width, height, format, { noise, seed });
          const prepared = await prepareImage(original, format);
          if (!prepared.ok) return;
          const sent = decode(prepared.dataUrl);
          expect(sent.bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
          const { width: w, height: h } = await loadImage(
            Buffer.from(sent.bytes),
          );
          expect(Math.max(w, h)).toBeLessThanOrEqual(MAX_IMAGE_LONG_SIDE);
          const withinLimits =
            original.length <= MAX_IMAGE_BYTES &&
            Math.max(width, height) <= MAX_IMAGE_LONG_SIDE;
          if (withinLimits) expect(sent.bytes).toEqual(original);
        },
      ),
      { numRuns: 15 },
    );
  });

  it("a PNG within 2000 pixels but over 3.75 MB is sent as a smaller JPEG, or refused if it can't be", async () => {
    const original = await image(2000, 1500, "png", { noise: true });
    expect(original.length).toBeGreaterThan(MAX_IMAGE_BYTES);
    const prepared = await prepareImage(original, "png");
    if (prepared.ok) {
      expect(prepared.resized).toBe(true);
      expect(decode(prepared.dataUrl).bytes.length).toBeLessThanOrEqual(
        MAX_IMAGE_BYTES,
      );
    } else {
      expect(prepared.reason).toMatch(/too large/);
    }
  });

  it("bytes that only look like an image are refused, saying so", async () => {
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(await prepareImage(broken, "jpeg")).toEqual({
      ok: false,
      reason: "the image couldn't be read",
    });
  });
});
