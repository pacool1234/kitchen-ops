import fc from "fast-check";
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

/** The error OpenRouter sent in #52 when Anthropic refused the schema, shortened. */
const providerError = {
  error: {
    code: 400,
    message: "Provider returned error",
    metadata: {
      raw: JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Schemas contains too many parameters with union types",
        },
      }),
      provider_name: "Azure",
      previous_errors: [{ code: 400, message: "Provider returned error" }],
    },
  },
};

async function errorMessage(
  status: number,
  body: unknown,
  apiKey = "test-key",
) {
  const { fetch } = fakeFetch(status, body);
  const client = createOpenRouterClient({ apiKey, fetch });
  const error = (await client
    .complete({ model: "m", messages: [] })
    .catch((e: unknown) => e)) as Error;
  return error.message;
}

describe("createOpenRouterClient: the provider's own error (#64)", () => {
  it("an error status gives the provider's message from error.metadata, with its name", async () => {
    expect(await errorMessage(400, providerError)).toBe(
      "OpenRouter answered 400: Provider returned error. Azure said: Schemas contains too many parameters with union types",
    );
  });

  it("so does a provider error inside a 200 reply", async () => {
    expect(await errorMessage(200, providerError)).toBe(
      "OpenRouter answered 200 with an error: Provider returned error. Azure said: Schemas contains too many parameters with union types",
    );
  });

  it("raw text that isn't JSON is used as it is, on one line", async () => {
    expect(
      await errorMessage(502, {
        error: {
          message: "Provider returned error",
          metadata: { raw: "upstream timed out\nafter 60 s" },
        },
      }),
    ).toBe(
      "OpenRouter answered 502: Provider returned error. The provider said: upstream timed out after 60 s",
    );
  });

  it("raw JSON with a top-level message is read too", async () => {
    expect(
      await errorMessage(400, {
        error: {
          message: "Provider returned error",
          metadata: {
            raw: JSON.stringify({ message: "model not found" }),
            provider_name: "Example",
          },
        },
      }),
    ).toBe(
      "OpenRouter answered 400: Provider returned error. Example said: model not found",
    );
  });

  it("raw JSON in another shape is used as it is", async () => {
    expect(
      await errorMessage(400, {
        error: {
          message: "Provider returned error",
          metadata: { raw: '{"detail":"bad request"}' },
        },
      }),
    ).toBe(
      'OpenRouter answered 400: Provider returned error. The provider said: {"detail":"bad request"}',
    );
  });

  it("with no metadata, the message is OpenRouter's alone", async () => {
    expect(
      await errorMessage(429, {
        error: { message: "Rate limit exceeded", metadata: {} },
      }),
    ).toBe("OpenRouter answered 429: Rate limit exceeded");
  });

  // Digits only, so no piece of the key can come from the message's own words.
  const key = fc.string({
    unit: fc.constantFrom(..."0123456789"),
    minLength: 20,
    maxLength: 40,
  });
  // Lengths are spelled out: fast-check keeps strings short, and the cut is at 500 characters.
  // Half the time the key lands near the cut, which falls about 440 characters into `raw`.
  const filler = fc
    .oneof(fc.integer({ min: 0, max: 700 }), fc.integer({ min: 380, max: 500 }))
    .map((n) => "x".repeat(n));

  it("never holds the key or any piece of it longer than 4 characters, wherever the cut falls", async () => {
    await fc.assert(
      fc.asyncProperty(key, filler, filler, async (apiKey, before, after) => {
        const message = await errorMessage(
          400,
          {
            error: {
              message: `Bad key ${apiKey}`,
              metadata: { raw: `${before}${apiKey}${after}` },
            },
          },
          apiKey,
        );
        for (let i = 0; i + 5 <= apiKey.length; i++) {
          expect(message).not.toContain(apiKey.slice(i, i + 5));
        }
      }),
    );
  });

  it("is at most 500 characters, whatever the provider sent", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .integer({ min: 0, max: 2000 })
          .chain((n) => fc.string({ minLength: n, maxLength: n })),
        async (raw) => {
          const message = await errorMessage(400, {
            error: { message: "Provider returned error", metadata: { raw } },
          });
          expect(message.length).toBeLessThanOrEqual(500);
        },
      ),
    );
  });

  // With no whitespace to collapse, the whole message's length is known. (A message of exactly
  // 500 characters isn't always a cut one: collapsing whitespace can shorten it to 500.)
  it("comes through whole up to 500 characters; past that, cut to 499 and an ellipsis", async () => {
    const start =
      "OpenRouter answered 400: Provider returned error. The provider said: ";
    await fc.assert(
      fc.asyncProperty(
        fc
          .oneof(
            fc.integer({ min: 1, max: 1000 }),
            // A whole message of exactly 500 and 501 characters, either side of the cut.
            fc.constantFrom(500 - start.length, 501 - start.length),
          )
          .map((n) => "x".repeat(n)),
        async (raw) => {
          const message = await errorMessage(400, {
            error: { message: "Provider returned error", metadata: { raw } },
          });
          const whole = `${start}${raw}`;
          expect(message).toBe(
            whole.length <= 500 ? whole : `${whole.slice(0, 499)}…`,
          );
        },
      ),
    );
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
