// Writes eval/gold/README.md from every gold folder's meta.json. Run after adding a document or
// editing a meta.json:
//   pnpm --filter @kitchen-ops/extract gold:readme
// Prints the document count only.
import { writeFileSync } from "node:fs";
import { GOLD_DIRECTORY, goldIds, readGoldEntry } from "../src/gold/gold-set";
import { GoldMeta } from "../src/gold/meta";
import { goldReadme } from "../src/gold/readme";

const entries = goldIds(GOLD_DIRECTORY).flatMap((id) => {
  const meta = GoldMeta.safeParse(readGoldEntry(GOLD_DIRECTORY, id).meta);
  if (meta.success) return [{ id, meta: meta.data }];
  console.error(`${id}: meta.json doesn't match the schema; left out`);
  process.exitCode = 1;
  return [];
});
writeFileSync(new URL("README.md", GOLD_DIRECTORY), goldReadme(entries));
console.log(`eval/gold/README.md: ${entries.length} documents`);
