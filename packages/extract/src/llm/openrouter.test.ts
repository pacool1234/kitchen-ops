import { describe, expect, it } from "vitest";
import {
  createOpenRouterClient,
  OpenRouterError,
  openRouterFromEnv,
} from "./openrouter";

/** A fake fetch that answers with `status` and `body`, and remembers what it was asked. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      {
        status,
      },
    );
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const reply = {
  choices: [{ message: { content: '{"ok":true}' } }],
  usage: { prompt_tokens: 1200, completion_tokens: 300, cost: 0.000815 },
};

describe("createOpenRouterClient: one chat completion", () => {
  it("POSTs the body as JSON to /chat/completions, with the key as a bearer token", async () => {
    const { fetch, calls } = fakeFetch(200, reply);
    const client = createOpenRouterClient({ apiKey: "test-key", fetch });
    await client.complete({ model: "vendor/model", messages: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      model: "vendor/model",
      messages: [],
    });
  });

  it("returns the reply's text, tokens and cost", async () => {
    const { fetch } = fakeFetch(200, reply);
    const client = createOpenRouterClient({ apiKey: "test-key", fetch });
    expect(await client.complete({ model: "m", messages: [] })).toEqual({
      content: '{"ok":true}',
      promptTokens: 1200,
      completionTokens: 300,
      cost: 0.000815,
    });
  });

  it("a reply without usage has unknown tokens and cost", async () => {
    const { fetch } = fakeFetch(200, {
      choices: [{ message: { content: "x" } }],
    });
    const client = createOpenRouterClient({ apiKey: "test-key", fetch });
    expect(await client.complete({ model: "m", messages: [] })).toEqual({
      content: "x",
      promptTokens: null,
      completionTokens: null,
      cost: null,
    });
  });

  it("an error status throws an OpenRouterError with the status and OpenRouter's message", async () => {
    const { fetch } = fakeFetch(429, {
      error: { code: 429, message: "Rate limit exceeded" },
    });
    const client = createOpenRouterClient({ apiKey: "test-key", fetch });
    const error = await client
      .complete({ model: "m", messages: [] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error).toMatchObject({
      status: 429,
      message: "OpenRouter answered 429: Rate limit exceeded",
    });
  });

  it("an error inside a 200 reply also throws", async () => {
    const { fetch } = fakeFetch(200, {
      error: { code: 502, message: "Provider returned error" },
    });
    const client = createOpenRouterClient({ apiKey: "test-key", fetch });
    await expect(client.complete({ model: "m", messages: [] })).rejects.toThrow(
      "OpenRouter answered 200 with an error: Provider returned error",
    );
  });

  it("a reply that isn't a chat completion throws", async () => {
    const { fetch } = fakeFetch(200, "<html>Bad gateway</html>");
    const client = createOpenRouterClient({ apiKey: "test-key", fetch });
    await expect(client.complete({ model: "m", messages: [] })).rejects.toThrow(
      OpenRouterError,
    );
  });

  it("never puts the API key in an error message", async () => {
    const { fetch } = fakeFetch(401, {
      error: { message: "Bad key test-key" },
    });
    const client = createOpenRouterClient({ apiKey: "test-key", fetch });
    const error = (await client
      .complete({ model: "m", messages: [] })
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain("test-key");
  });
});

describe("openRouterFromEnv: the key comes from OPENROUTER_API_KEY", () => {
  it("fails clearly when the variable is missing or empty", () => {
    expect(() => openRouterFromEnv({})).toThrow(
      "OPENROUTER_API_KEY is not set: add it to packages/extract/.env",
    );
    expect(() => openRouterFromEnv({ OPENROUTER_API_KEY: "" })).toThrow(
      "OPENROUTER_API_KEY is not set",
    );
  });

  it("uses the key from the environment given", async () => {
    const { fetch, calls } = fakeFetch(200, reply);
    await openRouterFromEnv({ OPENROUTER_API_KEY: "env-key" }, fetch).complete({
      model: "m",
      messages: [],
    });
    expect(calls[0]!.init.headers).toMatchObject({
      Authorization: "Bearer env-key",
    });
  });
});
