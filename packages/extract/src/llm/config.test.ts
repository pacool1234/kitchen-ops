import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { loadModels, MODELS_FILE } from "./config";
import { loadPrompt } from "./prompts";

function fileWith(content: string): URL {
  const directory = mkdtempSync(join(tmpdir(), "extract-config-"));
  const file = join(directory, "models.json");
  writeFileSync(file, content);
  return pathToFileURL(file);
}

describe("loadModels: model IDs come from config/models.json, never from code", () => {
  it("the committed models.json is valid", () => {
    expect(() => loadModels(MODELS_FILE)).not.toThrow();
  });

  it("reads each model's ID and whether it supports structured output", () => {
    const file = fileWith(
      JSON.stringify({
        models: [
          { id: "vendor/cheap-model", structuredOutput: true },
          {
            id: "vendor/other-model",
            structuredOutput: false,
            note: "no JSON mode",
          },
        ],
      }),
    );
    expect(loadModels(file)).toEqual([
      { id: "vendor/cheap-model", structuredOutput: true },
      {
        id: "vendor/other-model",
        structuredOutput: false,
        note: "no JSON mode",
      },
    ]);
  });

  it("rejects a model without an ID, or with an unknown key, naming the field", () => {
    expect(() =>
      loadModels(
        fileWith(JSON.stringify({ models: [{ structuredOutput: true }] })),
      ),
    ).toThrow("models.0.id");
    expect(() =>
      loadModels(
        fileWith(
          JSON.stringify({
            models: [{ id: "a/b", structuredOutput: true, price: 1 }],
          }),
        ),
      ),
    ).toThrow("models.0");
  });
});

describe("loadPrompt: prompts are versioned files", () => {
  it("v1 exists and asks for nulls instead of guesses", () => {
    const prompt = loadPrompt("v1");
    expect(prompt.version).toBe("v1");
    expect(prompt.text).toMatch(/null/);
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
