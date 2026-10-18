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

  it("reads each model's ID, whether it supports structured output and whether it can read images", () => {
    const file = fileWith(
      JSON.stringify({
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
          JSON.stringify({ models: [{ id: "a/b", structuredOutput: true }] }),
        ),
      ),
    ).toThrow("models.0.vision");
  });

  it("a temperature is optional, from 0 to 2 (#68)", () => {
    const models = (temperature: unknown) =>
      fileWith(
        JSON.stringify({
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
          JSON.stringify({
            models: [{ structuredOutput: true, vision: true }],
          }),
        ),
      ),
    ).toThrow("models.0.id");
    expect(() =>
      loadModels(
        fileWith(
          JSON.stringify({
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

describe("loadPrompt: prompts are versioned files", () => {
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
