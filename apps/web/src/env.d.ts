// Set at build time; see vite.config.ts and render.yaml.
interface ImportMetaEnv {
  /** The web Sentry project's DSN. Unset locally, which keeps Sentry off. */
  readonly VITE_SENTRY_DSN?: string;
  /** "staging" or "production" on Render. */
  readonly VITE_SENTRY_ENVIRONMENT?: string;
}

/** The commit being built (Render's RENDER_GIT_COMMIT), or "dev". */
declare const __APP_VERSION__: string;
