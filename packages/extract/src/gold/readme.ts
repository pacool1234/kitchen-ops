import { GOLD_KINDS, type GoldMeta } from "./meta";

// `eval/gold/README.md`: every gold document with its origin, kind and what makes it hard, written
// from the meta.json files so the two can't drift apart. A test checks it's up to date.

export interface ReadmeEntry {
  /** The folder name. */
  readonly id: string;
  readonly meta: GoldMeta;
}

/** One table cell: pipes escaped and line breaks joined, so a note can't break the table. */
function cell(text: string): string {
  return text
    .replaceAll("|", String.raw`\|`)
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

function row(cells: readonly string[]): string {
  return `|${cells.map((c) => (c === "" ? " " : ` ${c} `)).join("|")}|`;
}

export function goldReadme(entries: readonly ReadmeEntry[]): string {
  const counts = GOLD_KINDS.map(
    (kind) =>
      `${entries.filter((entry) => entry.meta.kind === kind).length} ${kind}`,
  );
  return [
    "# Gold set",
    "",
    "Committed eval documents: own, public or synthetic, never client documents. Each folder holds one `source.*`, its `expected.json` checked by a person, and a `meta.json`.",
    "",
    "Written from each folder's `meta.json` by `pnpm --filter @kitchen-ops/extract gold:readme`. Don't edit it by hand: edit the `meta.json` and run that instead.",
    "",
    `${entries.length} documents: ${counts.join(", ")}.`,
    "",
    row(["Folder", "Origin", "Kind", "Made", "What makes it hard"]),
    row(["---", "---", "---", "---", "---"]),
    ...entries.map(({ id, meta }) =>
      row([id, meta.origin, meta.kind, meta.made ?? "", cell(meta.notes)]),
    ),
    "",
  ].join("\n");
}
