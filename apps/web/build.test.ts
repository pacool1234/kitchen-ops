import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, describe, expect, it } from "vitest";

// Builds the web app as staging and production do, and as the browser tests do, into
// temporary folders, and reads what came out.

const outDirs: string[] = [];
afterAll(() => {
  for (const dir of outDirs) rmSync(dir, { recursive: true, force: true });
});

/** Every file a build of `mode` writes, as one text. */
async function builtText(mode: string): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), "kitchen-ops-web-"));
  outDirs.push(outDir);
  await build({
    root: import.meta.dirname,
    mode,
    logLevel: "silent",
    build: { outDir, emptyOutDir: true },
  });
  return readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(js|html)$/.test(entry.name))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

// The gallery's root element says data-testid="component-gallery".
const GALLERY = "component-gallery";

describe("the component gallery is in development and browser-test builds only (decision 0024)", () => {
  it("a production build has no gallery: no route and no code", async () => {
    expect(await builtText("production")).not.toContain(GALLERY);
  }, 120_000);

  it("the browser tests' build has it, so the check above can fail", async () => {
    expect(await builtText("e2e")).toContain(GALLERY);
  }, 120_000);
});
