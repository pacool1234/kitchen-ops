import { z } from "zod";

// postgres:// or postgresql://. The error never repeats the value: it contains a password.
const DatabaseUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: (issue) =>
    issue.input === undefined ? "is required" : "must be a postgres:// URL",
});

// An empty value (`SENTRY_DSN=` in .env) counts as unset.
const emptyAsUnset = (value: unknown) => (value === "" ? undefined : value);

// Every variable the API reads. Keep apps/api/.env.example in sync with this schema.
const ConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // 127.0.0.1 locally; Render needs 0.0.0.0 to reach the server.
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // Which build is running, returned by GET /health. The git commit on Render, "dev" locally.
  APP_VERSION: z
    .string({ error: "is required" })
    .min(1, { error: "must not be empty" }),
  DATABASE_URL: DatabaseUrl,
  // Signs session cookies and encrypts TOTP secrets. Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  BETTER_AUTH_SECRET: z
    .string({ error: "is required" })
    .min(32, { error: "must be at least 32 characters" }),
  // The API's public base URL, e.g. http://127.0.0.1:3000 locally.
  BETTER_AUTH_URL: z.url({
    protocol: /^https?$/,
    error: (issue) =>
      issue.input === undefined ? "is required" : "must be an http(s) URL",
  }),
  // The Sentry project's DSN. Unset locally and in tests, which keeps Sentry off.
  SENTRY_DSN: z.preprocess(
    emptyAsUnset,
    z.url({ protocol: /^https$/, error: "must be an https URL" }).optional(),
  ),
  // "staging" or "production" on Render. Unset: NODE_ENV.
  SENTRY_ENVIRONMENT: z.preprocess(emptyAsUnset, z.string().optional()),
  // Object storage for documents' files (decision 0029): Scaleway on Render, the local `s3`
  // service (docker-compose.yml) in development. All five, or none: without them the API starts,
  // and its document endpoints answer 503 storage_unavailable.
  S3_ENDPOINT: z.preprocess(
    emptyAsUnset,
    z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).optional(),
  ),
  S3_REGION: z.preprocess(emptyAsUnset, z.string().optional()),
  S3_BUCKET: z.preprocess(emptyAsUnset, z.string().optional()),
  S3_ACCESS_KEY_ID: z.preprocess(emptyAsUnset, z.string().optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess(emptyAsUnset, z.string().optional()),
});

const STORAGE_VARIABLES = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

// Storage is all or nothing: a half-set storage would fail on the first upload instead of now.
const ConfigWithStorage = ConfigSchema.superRefine((config, ctx) => {
  const set = STORAGE_VARIABLES.filter((name) => config[name] !== undefined);
  if (set.length > 0 && set.length < STORAGE_VARIABLES.length) {
    for (const name of STORAGE_VARIABLES.filter((n) => !set.includes(n))) {
      ctx.addIssue({
        code: "custom",
        path: [name],
        message: `is required with ${set.join(", ")}`,
      });
    }
  }
});

/** The storage settings, if all are set. */
export function storageConfig(config: Config) {
  const {
    S3_ENDPOINT,
    S3_REGION,
    S3_BUCKET,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
  } = config;
  if (
    !S3_ENDPOINT ||
    !S3_REGION ||
    !S3_BUCKET ||
    !S3_ACCESS_KEY_ID ||
    !S3_SECRET_ACCESS_KEY
  ) {
    return null;
  }
  return {
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  };
}

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

function parseEnv<T extends z.ZodType>(
  schema: T,
  env: Record<string, string | undefined>,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new ConfigError(
      [
        "Invalid environment configuration:",
        ...problems,
        "Copy apps/api/.env.example to apps/api/.env and fill it in, or set these variables.",
      ].join("\n"),
    );
  }
  return result.data;
}

/** Validates the environment once at startup. Throws a ConfigError listing every problem. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  return parseEnv(ConfigWithStorage, env);
}

/** For the migrate script, which needs only the database. */
export function loadDatabaseUrl(
  env: Record<string, string | undefined>,
): string {
  return parseEnv(ConfigSchema.pick({ DATABASE_URL: true }), env).DATABASE_URL;
}

/** For src/instrument.ts, which starts Sentry before the app (and the full check) loads. */
export function loadSentryConfig(env: Record<string, string | undefined>) {
  return parseEnv(
    ConfigSchema.pick({
      NODE_ENV: true,
      APP_VERSION: true,
      SENTRY_DSN: true,
      SENTRY_ENVIRONMENT: true,
    }),
    env,
  );
}

export type SentryConfig = ReturnType<typeof loadSentryConfig>;

/** For the seed, which needs the database and auth (to create users) but not the server settings. */
export function loadSeedConfig(env: Record<string, string | undefined>) {
  return parseEnv(
    ConfigSchema.pick({
      DATABASE_URL: true,
      BETTER_AUTH_SECRET: true,
      BETTER_AUTH_URL: true,
    }),
    env,
  );
}
