import { describe, expect, it } from "vitest";
import * as extract from "./index";

// What the API may use of extraction (#103): reading a document's files, checking the result,
// the default model and prompt, and the OpenRouter client a fake can stand in for. Nothing of
// the eval: it stays a command of this package.

describe("the package's public API", () => {
  it("exports what the API needs", () => {
    for (const name of [
      "extractFiles",
      "validate",
      "CHECKS",
      "defaultExtraction",
      "createOpenRouterClient",
      "openRouterFromEnv",
      "CLIENT_ROUTING",
      "detectFormat",
    ]) {
      expect(extract, name).toHaveProperty(name);
    }
  });

  it("exports nothing of the eval", () => {
    for (const name of [
      "runEval",
      "compareDocument",
      "acrossRuns",
      "loadModels",
      "loadPrompt",
    ]) {
      expect(extract, name).not.toHaveProperty(name);
    }
  });
});
