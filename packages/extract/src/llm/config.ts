import { readFileSync } from "node:fs";
import { z } from "zod";
import { loadPrompt, type Prompt } from "./prompts";

// Model IDs come from config, never from pipeline code (`.claude/rules/extract.md`).

export const ModelConfig = z.strictObject({
  /** OpenRouter's model ID, e.g. "vendor/model-name". */
  id: z.string().min(1),
  /** Whether the model honours `response_format: json_schema`. Otherwise the schema goes in the prompt. */
  structuredOutput: z.boolean(),
  /** Whether the model reads images. Photos and scans only go to models that do. */
  vision: z.boolean(),
  /** Sent with every call when set (#68); otherwise the provider's default applies. */
  temperature: z.number().min(0).max(2).optional(),
  /** Why it's on the list, or anything worth knowing about it. */
  note: z.string().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfig>;

const ModelsFile = z
  .strictObject({
    models: z.array(ModelConfig),
    /** What the pipeline extracts with (decision 0018). One entry, so there can't be two. */
    default: z.strictObject({ model: z.string(), prompt: z.string() }),
  })
  .superRefine((file, ctx) => {
    if (!file.models.some((model) => model.id === file.default.model)) {
      ctx.addIssue({
        code: "custom",
        path: ["default", "model"],
        message: `${file.default.model} isn't one of the models`,
      });
    }
  });

/** `packages/extract/config/models.json`. */
export const MODELS_FILE = new URL("../../config/models.json", import.meta.url);

/** A config file, checked. Throws naming the field if the file doesn't match. */
function loadModelsFile(file: URL): z.infer<typeof ModelsFile> {
  const result = ModelsFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`invalid model config: ${problems.join("; ")}`);
  }
  return result.data;
}

/** The models in a config file. */
export function loadModels(file: URL = MODELS_FILE): ModelConfig[] {
  return loadModelsFile(file).models;
}

/** The model and prompt the pipeline extracts with, for the API once it extracts documents. */
export function defaultExtraction(file: URL = MODELS_FILE): {
  model: ModelConfig;
  prompt: Prompt;
} {
  const { models, default: chosen } = loadModelsFile(file);
  // The file was checked: the default is one of its models.
  const model = models.find((m) => m.id === chosen.model)!;
  return { model, prompt: loadPrompt(chosen.prompt) };
}
