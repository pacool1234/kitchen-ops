import { readdirSync, readFileSync } from "node:fs";
import { ExtractedDocument } from "@kitchen-ops/shared";
import type { z } from "zod";
import { GoldMeta, KINDS_BY_EXTENSION } from "./meta";

/** `eval/gold/` at the repository root: committed own, public and synthetic documents. */
export const GOLD_DIRECTORY = new URL(
  "../../../../eval/gold/",
  import.meta.url,
);

/** One gold folder, as read from disk. */
export interface GoldEntry {
  /** The folder name. */
  readonly id: string;
  readonly files: readonly string[];
  /** Parsed `expected.json`, or undefined if it is missing or isn't valid JSON. */
  readonly expected: unknown;
  /** Parsed `meta.json`, or undefined if it is missing or isn't valid JSON. */
  readonly meta: unknown;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SOURCE = /^source\.([a-z]+)$/;
const KNOWN_FILES = new Set(["expected.json", "meta.json"]);

/** The gold folders in `directory`, sorted. */
export function goldIds(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readJson(file: URL): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function readGoldEntry(directory: URL, id: string): GoldEntry {
  const folder = new URL(`${id}/`, directory);
  return {
    id,
    files: readdirSync(folder).sort(),
    expected: readJson(new URL("expected.json", folder)),
    meta: readJson(new URL("meta.json", folder)),
  };
}

/** Zod's issues as "path: message", without the values, which may be document contents. */
function issues(file: string, error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${file}: ${issue.path.join(".")}: ${issue.message}`,
  );
}

/**
 * Everything wrong with one gold folder, each problem prefixed with the folder name. An empty
 * list means the folder is complete, valid and checked by a person. Messages name files and
 * fields, never document contents (`.claude/rules/extract.md`).
 */
export function goldEntryProblems(entry: GoldEntry): string[] {
  const problems: string[] = [];
  if (!ID.test(entry.id)) {
    problems.push(
      "the folder name must be lowercase letters, digits and hyphens",
    );
  }

  const sources = entry.files.filter((file) => SOURCE.test(file));
  const extension =
    sources.length === 1 ? sources[0]?.split(".")[1] : undefined;
  if (
    sources.length !== 1 ||
    extension === undefined ||
    !(extension in KINDS_BY_EXTENSION)
  ) {
    problems.push(
      `needs exactly one source file (source.pdf, .jpg, .png or .xml), found ${sources.length}`,
    );
  }
  for (const file of entry.files) {
    if (!KNOWN_FILES.has(file) && !SOURCE.test(file)) {
      problems.push(`unexpected file ${file}`);
    }
  }

  for (const [file, value] of [
    ["expected.json", entry.expected],
    ["meta.json", entry.meta],
  ] as const) {
    if (!entry.files.includes(file)) {
      problems.push(`missing ${file}`);
    } else if (value === undefined) {
      problems.push(`${file} isn't valid JSON`);
    }
  }

  if (entry.expected !== undefined) {
    const result = ExtractedDocument.safeParse(entry.expected);
    if (!result.success)
      problems.push(...issues("expected.json", result.error));
  }
  if (entry.meta !== undefined) {
    const result = GoldMeta.safeParse(entry.meta);
    if (!result.success) {
      problems.push(...issues("meta.json", result.error));
    } else {
      const kinds =
        extension === undefined ? undefined : KINDS_BY_EXTENSION[extension];
      if (kinds !== undefined && !kinds.includes(result.data.kind)) {
        problems.push(
          `a .${extension} source can't be of kind ${result.data.kind} (expected ${kinds.join(" or ")})`,
        );
      }
      const syntheticTextPdf =
        result.data.origin === "synthetic" && result.data.kind === "text-pdf";
      if (syntheticTextPdf && result.data.made === undefined) {
        problems.push(
          "a synthetic text PDF must say how it was made (meta.json: made: rendered or elsewhere)",
        );
      }
      if (!syntheticTextPdf && result.data.made !== undefined) {
        problems.push(
          "only a synthetic text PDF says how it was made (meta.json: made)",
        );
      }
      if (result.data.checked === null) {
        problems.push(
          "expected.json hasn't been checked against its source by a person (meta.json: checked)",
        );
      }
    }
  }

  return problems.map((problem) => `${entry.id}: ${problem}`);
}
