import { existsSync, readFileSync } from "node:fs";

// Prompts are versioned files (`packages/extract/prompts/v1.md`, v2…). A results file records
// the version it used, so runs can be compared over time. Suggesting products (#117) has its own
// versions, in `prompts/suggestions/`.

export interface Prompt {
  readonly version: string;
  readonly text: string;
}

const PROMPT_DIRECTORY = new URL("../../prompts/", import.meta.url);

/** What a prompt is for: reading a document, or suggesting products (decision 0036). */
export type PromptKind = "extraction" | "suggestions";

export function loadPrompt(
  version: string,
  kind: PromptKind = "extraction",
): Prompt {
  // Only "v" and digits, so a version can never point outside the prompts folder.
  if (!/^v\d+$/.test(version)) {
    throw new Error(
      `a prompt version looks like "v1", got ${JSON.stringify(version)}`,
    );
  }
  const file = new URL(
    kind === "extraction" ? `${version}.md` : `${kind}/${version}.md`,
    PROMPT_DIRECTORY,
  );
  if (!existsSync(file)) {
    throw new Error(
      `prompt ${version} doesn't exist in packages/extract/prompts`,
    );
  }
  return { version, text: readFileSync(file, "utf8") };
}
