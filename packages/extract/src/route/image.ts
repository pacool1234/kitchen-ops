import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";

// Photos and scans for a vision model (spec section 5, stage 2), within limits every large
// provider accepts. An image within them is sent unchanged; a larger one is scaled down.

/** Pixels on the long side: an A4 page at about 170 dpi, enough for printed text. */
export const MAX_IMAGE_LONG_SIDE = 2000;
/**
 * Bytes per image: 5 MB once base64-encoded, the strictest per-image limit among the large
 * providers (Anthropic's).
 */
export const MAX_IMAGE_BYTES = 3_932_160;
const JPEG_QUALITY = 85;

export type ImageFormat = "jpeg" | "png";

export type PreparedImage =
  | { readonly ok: true; readonly dataUrl: string; readonly resized: boolean }
  | { readonly ok: false; readonly reason: string };

function dataUrl(bytes: Uint8Array, format: ImageFormat): string {
  return `data:image/${format};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** `maxBytes` is only lowered by tests, to reach the last check. */
export async function prepareImage(
  bytes: Uint8Array,
  format: ImageFormat,
  { maxBytes = MAX_IMAGE_BYTES }: { maxBytes?: number } = {},
): Promise<PreparedImage> {
  let image: Image;
  try {
    image = await loadImage(Buffer.from(bytes));
  } catch {
    return { ok: false, reason: "the image couldn't be read" };
  }
  const longSide = Math.max(image.width, image.height);
  if (longSide <= MAX_IMAGE_LONG_SIDE && bytes.length <= maxBytes) {
    return { ok: true, dataUrl: dataUrl(bytes, format), resized: false };
  }

  const scale = Math.min(1, MAX_IMAGE_LONG_SIDE / longSide);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  // JPEG has no transparency: a transparent PNG goes on white, like paper.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const jpeg = new Uint8Array(await canvas.encode("jpeg", JPEG_QUALITY));
  if (jpeg.length > maxBytes) {
    return {
      ok: false,
      reason: `the image is too large: over ${maxBytes} bytes even at ${MAX_IMAGE_LONG_SIDE} pixels on its long side`,
    };
  }
  return { ok: true, dataUrl: dataUrl(jpeg, "jpeg"), resized: true };
}
