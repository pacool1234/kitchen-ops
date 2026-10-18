import { z } from "zod";

// A minimal OpenRouter client (decision 0007): one chat completion per call, with Node's own
// fetch, injected so tests never touch the network (`.claude/rules/extract.md`).

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** What came back from one call. Tokens and cost are null when OpenRouter didn't report them. */
export interface ChatReply {
  readonly content: string | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  /** In OpenRouter credits (1 credit = 1 US dollar), as reported in `usage.cost`. */
  readonly cost: number | null;
}

export interface OpenRouterClient {
  /** Sends one chat completion request body and returns the reply. Throws `OpenRouterError`. */
  complete(body: Record<string, unknown>): Promise<ChatReply>;
}

/** OpenRouter or the provider behind it answered with an error, or with something unreadable. */
export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

const ErrorBody = z.object({
  error: z.object({
    message: z.string(),
    // The provider's own reply, when the error came from it: `raw` is its body, as text.
    metadata: z
      .object({
        raw: z.unknown().optional(),
        provider_name: z.string().optional(),
      })
      .optional(),
  }),
});

/** The provider's reply as Anthropic and OpenAI shape it, or with a top-level message. */
const ProviderReply = z.union([
  z.object({ error: z.object({ message: z.string() }) }),
  z.object({ message: z.string() }),
]);

/** Errors are kept to this many characters, so a long provider reply can't fill a results file. */
const MAX_MESSAGE = 500;

/** What the provider said: the message in its JSON reply, or the reply itself if it isn't JSON. */
function providerMessage(raw: unknown): string | null {
  const value = typeof raw === "string" ? (parseJson(raw) ?? raw) : raw;
  const parsed = ProviderReply.safeParse(value);
  if (parsed.success) {
    return "error" in parsed.data
      ? parsed.data.error.message
      : parsed.data.message;
  }
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

const Completion = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      cost: z.number().optional(),
    })
    .optional(),
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createOpenRouterClient({
  apiKey,
  fetch = globalThis.fetch,
}: {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}): OpenRouterClient {
  /** OpenRouter's error message and the provider's, on one line, never echoing the key. */
  const errorMessage = (start: string, body: unknown) => {
    const parsed = ErrorBody.safeParse(body);
    let message = parsed.success
      ? parsed.data.error.message
      : "unreadable reply";
    const metadata = parsed.success ? parsed.data.error.metadata : undefined;
    const provider = providerMessage(metadata?.raw);
    if (provider !== null) {
      message += `. ${metadata?.provider_name ?? "The provider"} said: ${provider}`;
    }
    // The key is masked before the cut, so no part of it can survive at the end.
    const whole = `${start}: ${message}`
      .replaceAll(apiKey, "[key]")
      .replace(/\s+/g, " ");
    return whole.length > MAX_MESSAGE
      ? `${whole.slice(0, MAX_MESSAGE - 1)}…`
      : whole;
  };

  return {
    async complete(body) {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const reply = parseJson(await response.text());
      if (!response.ok) {
        throw new OpenRouterError(
          errorMessage(`OpenRouter answered ${response.status}`, reply),
          response.status,
        );
      }
      // Errors from the provider can also arrive inside a 200.
      if (ErrorBody.safeParse(reply).success) {
        throw new OpenRouterError(
          errorMessage(
            `OpenRouter answered ${response.status} with an error`,
            reply,
          ),
          response.status,
        );
      }
      const completion = Completion.safeParse(reply);
      if (!completion.success) {
        throw new OpenRouterError(
          `OpenRouter answered ${response.status} with something that isn't a chat completion`,
          response.status,
        );
      }
      const { choices, usage } = completion.data;
      return {
        content: choices[0]?.message.content ?? null,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        cost: usage?.cost ?? null,
      };
    },
  };
}

/** A client with the key from `OPENROUTER_API_KEY`. The eval loads it from `packages/extract/.env`. */
export function openRouterFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetch?: typeof globalThis.fetch,
): OpenRouterClient {
  const apiKey = env.OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error(
      "OPENROUTER_API_KEY is not set: add it to packages/extract/.env",
    );
  }
  return createOpenRouterClient({ apiKey, ...(fetch ? { fetch } : {}) });
}
