import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ExtractedDocument } from "@kitchen-ops/shared";
import { GOLD_DIRECTORY } from "../gold/gold-set";
import type { DocumentSource } from "../llm/extract";

// The sets an eval run goes through (spec section 5, evaluation harness). The gold set is
// committed. The private set holds client documents: its folder comes only from an environment
// variable the repo owner sets, it is always sent with restricted routing, and its results stay
// in its own folder, never in the repo's tracked files (`.claude/rules/extract.md`).

export const SET_NAMES = ["gold", "private"] as const;
export type SetName = (typeof SET_NAMES)[number];

/** Where the private set is. Set it in packages/extract/.env; never write the path in code. */
export const PRIVATE_SET_VARIABLE = "EVAL_PRIVATE_DIR";

/** `eval/results/` at the repository root: gold results, committed. */
export const RESULTS_DIRECTORY = new URL(
  "../../../../eval/results/",
  import.meta.url,
);

export interface EvalDocument {
  /** The folder name. Never shown for the private set, where it may name a client. */
  readonly id: string;
  readonly source: Uint8Array;
  readonly gold: ExtractedDocument;
}

export interface EvalSet {
  readonly name: SetName;
  /** Decided by the set, so a client document can't be sent without restricted routing. */
  readonly source: DocumentSource;
  readonly documents: readonly EvalDocument[];
  readonly resultsDirectory: string;
}

const SOURCE = /^source\.[a-z]+$/;

/**
 * Each folder in `directory` (but `results`) as a document: its `source.*` and `expected.json`.
 * `label` names a folder in error messages.
 */
function readDocuments(
  directory: string,
  label: (folder: string, position: number) => string,
): EvalDocument[] {
  const folders = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "results")
    .map((entry) => entry.name)
    .sort();
  return folders.map((folder, i) => {
    const name = label(folder, i + 1);
    const files = readdirSync(join(directory, folder));
    const source = files.find((file) => SOURCE.test(file));
    if (source === undefined) throw new Error(`${name}: no source file`);
    let expected: unknown;
    try {
      expected = JSON.parse(
        readFileSync(join(directory, folder, "expected.json"), "utf8"),
      );
    } catch {
      throw new Error(`${name}: expected.json is missing or isn't JSON`);
    }
    const gold = ExtractedDocument.safeParse(expected);
    if (!gold.success) {
      throw new Error(
        `${name}: expected.json doesn't match the extraction schema`,
      );
    }
    return {
      id: folder,
      source: new Uint8Array(readFileSync(join(directory, folder, source))),
      gold: gold.data,
    };
  });
}

export function loadSet(
  name: SetName,
  env: Readonly<Record<string, string | undefined>> = process.env,
  {
    goldDirectory = GOLD_DIRECTORY,
    resultsDirectory = RESULTS_DIRECTORY,
  }: { goldDirectory?: URL; resultsDirectory?: URL } = {},
): EvalSet {
  if (name === "gold") {
    return {
      name,
      // Synthetic documents, but routed like client ones: a run measures the providers that
      // staging and production can reach (decision 0031).
      source: "client",
      documents: readDocuments(
        fileURLToPath(goldDirectory),
        (folder) => folder,
      ),
      resultsDirectory: fileURLToPath(resultsDirectory),
    };
  }
  const directory = env[PRIVATE_SET_VARIABLE];
  if (directory === undefined || directory === "") {
    throw new Error(
      `${PRIVATE_SET_VARIABLE} is not set: add the private set's folder to packages/extract/.env`,
    );
  }
  return {
    name,
    source: "client",
    documents: readDocuments(
      directory,
      (_folder, position) => `document ${position}`,
    ),
    resultsDirectory: join(directory, "results"),
  };
}
