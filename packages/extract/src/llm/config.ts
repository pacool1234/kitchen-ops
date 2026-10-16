import { readFileSync } from "node:fs";
import { z } from "zod";

// Model IDs come from config, never from pipeline code (`.claude/rules/extract.md`).

export const ModelConfig = z.strictObject({
  /** OpenRouter's model ID, e.g. "vendor/model-name". */
  id: z.string().min(1),
  /** Whether the model honours `response_format: json_schema`. Otherwise the schema goes in the prompt. */
  structuredOutput: z.boolean(),
  /** Whether the model reads images. Photos and scans only go to models that do. */
  vision: z.boolean(),
  /** Why it's on the list, or anything worth knowing about it. */
  note: z.string().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfig>;

const ModelsFile = z.strictObject({ models: z.array(ModelConfig) });

/** `packages/extract/config/models.json`. */
export const MODELS_FILE = new URL("../../config/models.json", import.meta.url);

/** The models in a config file. Throws naming the field if the file doesn't match. */
export function loadModels(file: URL = MODELS_FILE): ModelConfig[] {
  const result = ModelsFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`invalid model config: ${problems.join("; ")}`);
  }
  return result.data.models;
}
