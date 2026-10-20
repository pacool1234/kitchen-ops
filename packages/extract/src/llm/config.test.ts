import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  defaultExtraction,
  defaultSuggestion,
  loadModels,
  MODELS_FILE,
} from "./config";
import { loadPrompt } from "./prompts";

function fileWith(content: string): URL {
  const directory = mkdtempSync(join(tmpdir(), "extract-config-"));
  const file = join(directory, "models.json");
  writeFileSync(file, content);
  return pathToFileURL(file);
}

/** A models file's JSON, with a default naming its first model unless one is given. */
function withDefault(config: {
  models: Record<string, unknown>[];
  default?: unknown;
  suggestion?: unknown;
}): string {
  return JSON.stringify({
    default: { model: config.models[0]?.["id"] ?? "a/b", prompt: "v1" },
    ...config,
  });
}

describe("loadModels: model IDs come from config/models.json, never from code", () => {
  it("the committed models.json is valid", () => {
    expect(() => loadModels(MODELS_FILE)).not.toThrow();
  });

  it("reads each model's ID, whether it supports structured output and whether it can read images", () => {
    const file = fileWith(
      withDefault({
        models: [
          { id: "vendor/cheap-model", structuredOutput: true, vision: true },
          {
            id: "vendor/other-model",
            structuredOutput: false,
            vision: false,
            note: "no JSON mode",
          },
        ],
      }),
    );
    expect(loadModels(file)).toEqual([
      { id: "vendor/cheap-model", structuredOutput: true, vision: true },
      {
        id: "vendor/other-model",
        structuredOutput: false,
        vision: false,
        note: "no JSON mode",
      },
    ]);
  });

  it("a model must say whether it can read images: photos and scans only go to models that can", () => {
    expect(() =>
      loadModels(
        fileWith(
          withDefault({ models: [{ id: "a/b", structuredOutput: true }] }),
        ),
      ),
    ).toThrow("models.0.vision");
  });

  it("a temperature is optional, from 0 to 2 (#68)", () => {
    const models = (temperature: unknown) =>
      fileWith(
        withDefault({
          models: [
            { id: "a/b", structuredOutput: true, vision: true, temperature },
          ],
        }),
      );
    expect(loadModels(models(0))[0]!.temperature).toBe(0);
    expect(loadModels(models(2))[0]!.temperature).toBe(2);
    expect(loadModels(models(0.7))[0]!.temperature).toBe(0.7);
    expect(() => loadModels(models(-0.1))).toThrow("models.0.temperature");
    expect(() => loadModels(models(2.1))).toThrow("models.0.temperature");
    expect(() => loadModels(models("0"))).toThrow("models.0.temperature");
  });

  it("rejects a model without an ID, or with an unknown key, naming the field", () => {
    expect(() =>
      loadModels(
        fileWith(
          withDefault({
            models: [{ structuredOutput: true, vision: true }],
          }),
        ),
      ),
    ).toThrow("models.0.id");
    expect(() =>
      loadModels(
        fileWith(
          withDefault({
            models: [
              { id: "a/b", structuredOutput: true, vision: true, price: 1 },
            ],
          }),
        ),
      ),
    ).toThrow("models.0");
  });
});

/** The one rule prompt v2 adds to v1, in rule 4 (#63). */
const LEGAL_NAME_RULE =
  " Its name is the legal name printed with its tax ID: the company name, with S.L., S.A. or similar as printed, or for a self-employed supplier the person's full name. Never a brand, logo or trade name, even when it is printed larger.";

const model = (id: string) => ({ id, structuredOutput: true, vision: true });

describe("the default model and prompt (#70)", () => {
  it("the committed default is decision 0018's: Gemini 3.8 Flash with prompt v2, at the provider's temperature (0031)", () => {
    const { model, prompt } = defaultExtraction(MODELS_FILE);
    expect(model.id).toBe("google/gemini-3.8-flash");
    // With zero retention only Vertex serves it, and Vertex doesn't take a temperature: with
    // one set, OpenRouter finds no endpoint and every client document fails (decision 0031).
    expect(model.temperature).toBeUndefined();
    expect(prompt.version).toBe("v2");
    expect(prompt.text).toBe(loadPrompt("v2").text);
  });

  it("a file with no default is refused, naming it", () => {
    const file = fileWith(JSON.stringify({ models: [model("a/b")] }));
    expect(() => loadModels(file)).toThrow("default");
  });

  it("a default naming a model that isn't in the list is refused, naming the model", () => {
    const file = fileWith(
      JSON.stringify({
        models: [model("a/b")],
        default: { model: "a/other", prompt: "v1" },
      }),
    );
    expect(() => loadModels(file)).toThrow(
      "default.model: a/other isn't one of the models",
    );
  });

  it("a default prompt with no prompt file is refused, naming the version", () => {
    const file = fileWith(
      JSON.stringify({
        models: [model("a/b")],
        default: { model: "a/b", prompt: "v999" },
      }),
    );
    expect(() => defaultExtraction(file)).toThrow("prompt v999");
  });

  it("any models, any default: the file loads exactly when the default is one of them, and gives back that model's whole config", () => {
    const id = fc.constantFrom("a/one", "a/two", "b/three", "b/four");
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            id,
            structuredOutput: fc.boolean(),
            vision: fc.boolean(),
            temperature: fc.option(fc.constantFrom(0, 0.5, 2), {
              nil: undefined,
            }),
          }),
          { selector: (m) => m.id, maxLength: 4 },
        ),
        id,
        (models, chosen) => {
          const file = fileWith(
            JSON.stringify({
              models,
              default: { model: chosen, prompt: "v1" },
            }),
          );
          const listed = models.find((m) => m.id === chosen);
          if (listed === undefined) {
            expect(() => defaultExtraction(file)).toThrow(chosen);
          } else {
            expect(defaultExtraction(file).model).toEqual(
              JSON.parse(JSON.stringify(listed)),
            );
          }
        },
      ),
    );
  });
});

describe("the model and prompt that suggest products (#117, decision 0036)", () => {
  it("the committed one is reading's model, Gemini 3.8 Flash, with the suggestions prompt v1", () => {
    const { model, prompt } = defaultSuggestion(MODELS_FILE);
    expect(model).toEqual(defaultExtraction(MODELS_FILE).model);
    expect(prompt.version).toBe("v1");
    expect(prompt.text).toBe(loadPrompt("v1", "suggestions").text);
  });

  it("is optional in a models file, but asking for it then fails, naming it", () => {
    const file = fileWith(withDefault({ models: [model("a/b")] }));
    expect(() => loadModels(file)).not.toThrow();
    expect(() => defaultSuggestion(file)).toThrow("suggestion");
  });

  it("one naming a model that isn't in the list is refused, naming the model", () => {
    const file = fileWith(
      withDefault({
        models: [model("a/b")],
        suggestion: { model: "a/other", prompt: "v1" },
      }),
    );
    expect(() => loadModels(file)).toThrow(
      "suggestion.model: a/other isn't one of the models",
    );
  });
});

describe("loadPrompt: prompts are versioned files", () => {
  it("the suggestions prompt v1 is its own file, and asks for null rather than a guess", () => {
    const prompt = loadPrompt("v1", "suggestions");
    expect(prompt).toEqual({
      version: "v1",
      text: expect.stringMatching(/null/),
    });
    expect(prompt.text).not.toBe(loadPrompt("v1").text);
  });

  it("v1 exists and asks for nulls instead of guesses", () => {
    const prompt = loadPrompt("v1");
    expect(prompt.version).toBe("v1");
    expect(prompt.text).toMatch(/null/);
  });

  it("v2 is exactly v1 plus the rule on the supplier's legal name, so a comparison isolates it (#63)", () => {
    const v1 = loadPrompt("v1").text;
    const v2 = loadPrompt("v2");
    expect(v2.version).toBe("v2");
    expect(v2.text).toContain(LEGAL_NAME_RULE);
    expect(v2.text.replace(LEGAL_NAME_RULE, "")).toBe(v1);
  });

  it("an unknown version fails, naming it", () => {
    expect(() => loadPrompt("v999")).toThrow("prompt v999");
  });

  it("only versions like v1, v2 are accepted, so a version can't point outside the prompts folder", () => {
    expect(() => loadPrompt("../package")).toThrow(
      'a prompt version looks like "v1", got "../package"',
    );
  });
});
