import { createCanvas } from "@napi-rs/canvas";
import PDFDocument from "pdfkit";

// Synthetic files for the routing tests. Not used by the pipeline.

/** A PDF whose pages are only images, as a scanner saves them: no text layer. */
export async function imageOnlyPdf(
  pages: readonly Uint8Array[],
): Promise<Uint8Array> {
  const document = new PDFDocument({ autoFirstPage: false, margin: 0 });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise((resolve) => document.on("end", resolve));
  for (const page of pages) {
    document.addPage({ size: "A4", margin: 0 });
    document.image(Buffer.from(page), 0, 0, { fit: [595.28, 841.89] });
  }
  document.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}

/** A small plain image, as a phone photo would arrive: JPEG or PNG. */
export async function plainImage(
  format: "jpeg" | "png",
  width = 300,
  height = 400,
): Promise<Uint8Array> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#f4f1ea";
  context.fillRect(0, 0, width, height);
  return new Uint8Array(
    format === "png"
      ? await canvas.encode("png")
      : await canvas.encode("jpeg", 90),
  );
}
