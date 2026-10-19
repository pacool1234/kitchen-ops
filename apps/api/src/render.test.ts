import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Staging's demo, as render.yaml sets it up (#100). Read as text, without a YAML library: these
// checks are about which service a line belongs to, and the file's indentation says that.

const RENDER_YAML = readFileSync(
  new URL("../../../render.yaml", import.meta.url),
  "utf8",
);
const lines = RENDER_YAML.split("\n");

/** A service's lines: from its `- name:` to the next item at its indentation, or less. */
function service(name: string): string {
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start === -1) throw new Error(`no service ${name} in render.yaml`);
  const indent = lines[start]!.indexOf("-");
  const end = lines.findIndex(
    (l, i) =>
      i > start &&
      l.trim() !== "" &&
      (l.search(/\S/) < indent ||
        (l.search(/\S/) === indent && l.trim().startsWith("- "))),
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

/** How often `word` is in the settings, comments left out: they may explain it anywhere. */
const occurrences = (text: string, word: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")
    .split(word).length - 1;

const PASSWORDS = [
  "DEMO_PASSWORD_COUNTER",
  "DEMO_PASSWORD_OFFICE",
  "DEMO_PASSWORD_OWNER",
];
const staging = service("kitchen-ops-api-staging");
const production = service("kitchen-ops-api");

describe("render.yaml: staging's demo seed (#100)", () => {
  it('the staging API asks for the demo seed: SEED_DEMO is "true"', () => {
    expect(staging).toMatch(/- key: SEED_DEMO\n\s+value: "true"/);
  });

  it("each demo password is entered in Render's dashboard, never written here", () => {
    for (const name of PASSWORDS) {
      expect(staging, name).toMatch(
        new RegExp(`- key: ${name}\\n\\s+sync: false`),
      );
    }
  });

  it("the seed runs after the migrations and before the server starts", () => {
    const start = /startCommand: (.*)/.exec(staging)?.[1] ?? "";
    const migrate = start.indexOf("db:migrate");
    const seed = start.indexOf("db:seed");
    const server = start.indexOf("src/server.ts");
    expect(migrate).toBeGreaterThan(-1);
    expect(seed).toBeGreaterThan(migrate);
    expect(server).toBeGreaterThan(seed);
  });

  it("nothing else in the file seeds, or has the demo's variables: production least of all", () => {
    for (const word of ["SEED_DEMO", "db:seed", ...PASSWORDS]) {
      expect(occurrences(RENDER_YAML, word), word).toBe(
        occurrences(staging, word),
      );
      expect(occurrences(production, word), word).toBe(0);
    }
  });
});
