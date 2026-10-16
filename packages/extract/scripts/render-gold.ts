// Renders source.pdf for every synthetic text-PDF gold document from its expected.json.
// Run after writing or editing an expected.json:
//   pnpm --filter @kitchen-ops/extract gold:render
// Prints folder names only, never document contents.
import { writeFileSync } from "node:fs";
import { ExtractedDocument } from "@kitchen-ops/shared";
import { GOLD_DIRECTORY, goldIds, readGoldEntry } from "../src/gold/gold-set";
import { GoldMeta } from "../src/gold/meta";
import { renderGoldPdf } from "../src/gold/render";

for (const id of goldIds(GOLD_DIRECTORY)) {
  const entry = readGoldEntry(GOLD_DIRECTORY, id);
  const meta = GoldMeta.safeParse(entry.meta);
  if (!meta.success || meta.data.origin !== "synthetic") continue;
  if (meta.data.kind !== "text-pdf") continue;

  const expected = ExtractedDocument.safeParse(entry.expected);
  if (!expected.success) {
    console.error(`${id}: expected.json doesn't match the schema; skipped`);
    process.exitCode = 1;
    continue;
  }
  const pdf = await renderGoldPdf(expected.data);
  writeFileSync(new URL(`${id}/source.pdf`, GOLD_DIRECTORY), pdf);
  console.log(`${id}: rendered`);
}
