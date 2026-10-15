# 0013. Production runs the API's TypeScript with tsx

- Status: Accepted
- Date: 2026-10-15

## Context

The API has never had a compile step: development, tests and the migration and seed scripts all run the TypeScript sources through tsx, and typechecking is a separate CI step (`tsc` with `noEmit`). Workspace packages export their `.ts` sources (`"exports": "./src/index.ts"`), and relative imports have no file extension (`moduleResolution: "bundler"`). Deploying to Render (#9) needs a way to start the API in production.

## Decision

Production starts the API with `node --import tsx src/server.ts` (the `start` script). tsx is a production dependency of `apps/api`, and Render installs production dependencies only.

- One Node process: `--import tsx` registers tsx as a loader inside Node, instead of the `tsx` command running Node as a child process. Render's SIGTERM reaches the graceful shutdown in `server.ts` directly.
- The code that runs in production is the code that runs in development and tests; there is no build output that could differ.
- CI starts the API this way on every pull request ("API starts in production mode").
- Cost: tsx compiles each file when it is first loaded, adding a fraction of a second to startup. Nothing changes once the server is listening.

## Alternatives considered

- **Compile with `tsc` to JavaScript:** Node's ES modules need file extensions, so every relative import would need a `.js` ending, and every workspace package would need its own build and a `dist` export.
- **Bundle with esbuild or tsdown:** one file to run, but the workspace packages must be bundled while npm packages stay external, and `migrate.ts` finds the migrations folder relative to its own location, which bundling changes. More configuration to get right for no gain at this size.
- **Node's built-in type stripping:** no extra dependency, but it also needs `.ts` extensions in every import, and it only accepts TypeScript syntax that can simply be erased (no enums, for example).

Revisit if startup time or memory becomes a problem; bundling is the next step.
