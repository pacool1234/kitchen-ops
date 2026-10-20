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
    /** What suggests products for unmatched lines (decision 0036); its prompt is a suggestions one. */
    suggestion: z
      .strictObject({ model: z.string(), prompt: z.string() })
      .optional(),
  })
  .superRefine((file, ctx) => {
    for (const key of ["default", "suggestion"] as const) {
      const chosen = file[key]?.model;
      if (chosen !== undefined && !file.models.some((m) => m.id === chosen)) {
        ctx.addIssue({
          code: "custom",
          path: [key, "model"],
          message: `${chosen} isn't one of the models`,
        });
      }
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

/** The model and prompt that suggest products for unmatched lines (decision 0036). */
export function defaultSuggestion(file: URL = MODELS_FILE): {
  model: ModelConfig;
  prompt: Prompt;
} {
  const { models, suggestion } = loadModelsFile(file);
  if (!suggestion) {
    throw new Error("invalid model config: no suggestion model and prompt");
  }
  // The file was checked: the suggestion's model is one of its models.
  const model = models.find((m) => m.id === suggestion.model)!;
  return { model, prompt: loadPrompt(suggestion.prompt, "suggestions") };
}
