import { z } from "zod";

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
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Validates the environment once at startup. Throws a ConfigError listing every problem. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = ConfigSchema.safeParse(env);
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
