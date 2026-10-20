import {
  createOpenRouterClient,
  defaultExtraction,
  type ModelConfig,
  type OpenRouterClient,
  type Prompt,
} from "@kitchen-ops/extract";
import type { ExtractionConfig } from "../config";
import { createFakeClient, FAKE_MODEL } from "./fake";
import { JOB_SETTINGS, type JobSettings } from "./jobs";

// What reads documents (#104): the default model and prompt (decision 0018) through OpenRouter,
// or the fake model. Tests pass their own client.

export interface Reader {
  readonly client: OpenRouterClient;
  readonly model: ModelConfig;
  readonly prompt: Prompt;
}

/**
 * How long one call to the model may take: ten photos can take a minute or two. One that takes
 * longer fails like a network error, and its try is made again.
 */
export const CALL_TIMEOUT_MS = 3 * 60_000;

export function readerFor(
  config: ExtractionConfig,
  now: () => Date = () => new Date(),
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Reader {
  const { model, prompt } = defaultExtraction();
  if (config.model === "fake") {
    return { client: createFakeClient(now), model: FAKE_MODEL, prompt };
  }
  return {
    client: createOpenRouterClient({
      apiKey: config.apiKey,
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }),
    }),
    model,
    prompt,
  };
}

/**
 * How soon a failed try is tried again. The fake model fails only when told to, never because a
 * service is down, so waiting is pointless: a second, without backoff, and a browser test sees
 * the failure in seconds (#106). It never runs in production (src/config.ts).
 */
export function jobSettingsFor(config: ExtractionConfig | null): JobSettings {
  return config?.model === "fake"
    ? { ...JOB_SETTINGS, retryDelaySeconds: 1, retryBackoff: false }
    : JOB_SETTINGS;
}
