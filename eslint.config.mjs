// One ESLint config for the whole workspace. Run with `pnpm lint` from the root.
import { fileURLToPath } from "node:url";
import { includeIgnoreFile } from "@eslint/compat";
import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from "@vue/eslint-config-typescript";
import boundaries from "eslint-plugin-boundaries";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";

// ESLint does not read .gitignore by itself; reuse it so ignored folders are never linted.
const gitignore = fileURLToPath(new URL(".gitignore", import.meta.url));

// Dependency rules from docs/spec.md section 2 (Decided). Each workspace package is one element.
const elements = [
  { type: "web", pattern: "apps/web" },
  { type: "api", pattern: "apps/api" },
  { type: "ledger", pattern: "packages/ledger" },
  { type: "extract", pattern: "packages/extract" },
  { type: "shared", pattern: "packages/shared" },
];

export default defineConfigWithVueTs(
  includeIgnoreFile(gitignore),
  { ignores: ["pnpm-lock.yaml"] },

  js.configs.recommended,
  pluginVue.configs["flat/recommended"],
  vueTsConfigs.recommended,

  {
    files: ["apps/web/src/**"],
    languageOptions: { globals: globals.browser },
  },
  {
    // Config files and repo scripts run in Node.
    files: ["**/*.{js,mjs,cjs}", "**/vite.config.ts", "apps/api/**"],
    languageOptions: { globals: globals.node },
  },

  {
    files: ["apps/**/*.{ts,vue}", "packages/**/*.ts"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": elements,
      "boundaries/files": [
        { category: "test", pattern: "**/*.{test,spec}.ts" },
        { category: "config", pattern: "**/*.config.ts" },
      ],
      // Resolves "@kitchen-ops/<name>" through each package's `exports` to its real folder,
      // so imports by package name and by relative path are both checked.
      "import/resolver": {
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          // Also check npm packages and node: built-ins, so `ledger` can be kept dependency-free.
          checkAllOrigins: true,
          policies: [
            {
              // Decision 0016: validation checks line totals with the ledger's own rule.
              from: { element: { type: "extract" } },
              allow: { to: { element: { type: ["ledger", "shared"] } } },
            },
            {
              from: { element: { type: "api" } },
              allow: {
                to: { element: { type: ["ledger", "extract", "shared"] } },
              },
            },
            {
              from: { element: { type: "web" } },
              allow: { to: { element: { type: "shared" } } },
            },

            // Every package except ledger may use npm packages and Node built-ins.
            {
              from: { element: { type: ["web", "api", "extract", "shared"] } },
              allow: { to: { module: { origin: ["external", "core"] } } },
            },
            // Ledger is pure: no runtime dependencies and no Node built-ins (decision 0015 chose
            // bigint over a decimal library). Its tests and tool config files (e.g.
            // vitest.config.ts) may use dev tooling and Node built-ins: the invariant coverage
            // check reads the test files.
            {
              from: {
                element: { type: "ledger" },
                file: { categories: ["test", "config"] },
              },
              allow: { to: { module: { origin: ["external", "core"] } } },
            },
          ],
        },
      ],
    },
  },

  {
    // The ledger is pure (spec section 4): no Node globals in its library code. @types/node is
    // installed for its tests, so the type checker no longer rejects these; this rule does.
    files: ["packages/ledger/src/**/*.ts"],
    ignores: ["packages/ledger/src/**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...[
          "process",
          "Buffer",
          "global",
          "require",
          "module",
          "__dirname",
          "__filename",
          "setImmediate",
        ].map((name) => ({
          name,
          message: "The ledger is pure: no Node globals in its library code.",
        })),
      ],
    },
  },

  {
    // Every string the interface shows goes through i18n (#86): no raw text in templates, nor
    // in the attributes people read (alt, title, aria-label, placeholder and the like).
    files: ["apps/web/src/**/*.vue"],
    rules: { "vue/no-bare-strings-in-template": "error" },
  },

  // Last, so Prettier owns formatting and ESLint only reports problems.
  eslintConfigPrettier,
);
