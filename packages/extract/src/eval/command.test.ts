import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GOLD_DIRECTORY } from "../gold/gold-set";
import { CLIENT_ROUTING } from "../llm/extract";
import type { OpenRouterClient } from "../llm/openrouter";
import {
  checkPrivateResultsDirectory,
  EVAL_CONFIG_FILE,
  evalCommand,
  isIgnoredByGit,
  loadEvalConfig,
  parseUsd,
  REPO_ROOT,
  type CommandDeps,
} from "./command";
import { PRIVATE_SET_VARIABLE } from "./sets";

const gold = fileURLToPath(GOLD_DIRECTORY);
const TEXT_PDF = "syn-002-invoice-discounts-two-vat";
const FACTURAE = "syn-006-facturae";
const goldAnswer = readFileSync(join(gold, TEXT_PDF, "expected.json"), "utf8");

const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

/** A temporary set holding copies of gold documents, under the folder names given. */
function setFolder(documents: Record<string, string>): string {
  const directory = temp("eval-set-");
  for (const [folder, goldId] of Object.entries(documents)) {
    cpSync(join(gold, goldId), join(directory, folder), { recursive: true });
  }
  return directory;
}

function modelsFile(...ids: string[]): URL {
  const file = join(temp("eval-models-"), "models.json");
  writeFileSync(
    file,
    JSON.stringify({
      models: ids.map((id) => ({ id, structuredOutput: true, vision: true })),
      default: { model: ids[0], prompt: "v1" },
    }),
  );
  return pathToFileURL(file);
}

/** A fake client answering the text PDF's gold answer, remembering requests. */
function fakeClient() {
  const requests: Record<string, unknown>[] = [];
  const client: OpenRouterClient = {
    complete: async (body) => {
      requests.push(structuredClone(body));
      return {
        content: goldAnswer,
        promptTokens: 1000,
        completionTokens: 200,
        cost: 0.0012,
      };
    },
  };
  return { client, requests };
}

const noCalls: OpenRouterClient = {
  complete: async () => {
    throw new Error("the model was called");
  },
};

/** Everything a test run needs, all in temporary folders. */
function deps(overrides: Partial<CommandDeps> = {}): CommandDeps & {
  results: string;
} {
  const results = temp("eval-results-");
  return {
    env: {},
    client: fakeClient().client,
    today: "2026-10-18",
    modelsFile: modelsFile("vendor/model-a", "vendor/model-b"),
    goldDirectory: pathToFileURL(
      setFolder({ [TEXT_PDF]: TEXT_PDF, [FACTURAE]: FACTURAE }) + "/",
    ),
    resultsDirectory: pathToFileURL(results + "/"),
    log: () => {},
    ...overrides,
    results,
  };
}

const args = (...extra: string[]) => [
  "--set",
  "gold",
  "--model",
  "vendor/model-a",
  "--prompt",
  "v1",
  ...extra,
];

describe("evalCommand: one run, a results file and a summary per model", () => {
  it("writes <date>-<model>-<prompt>.json and .md for the gold set", async () => {
    const d = deps();
    await evalCommand(args(), d);
    expect(readdirSync(d.results).sort()).toEqual([
      "2026-10-18-vendor-model-a-v1.json",
      "2026-10-18-vendor-model-a-v1.md",
    ]);
    const json = JSON.parse(
      readFileSync(
        join(d.results, "2026-10-18-vendor-model-a-v1.json"),
        "utf8",
      ),
    );
    expect(json.summary.outcomes).toEqual({
      correct: 2,
      "silent-error": 0,
      review: 0,
    });
    const md = readFileSync(
      join(d.results, "2026-10-18-vendor-model-a-v1.md"),
      "utf8",
    );
    expect(md).toMatch(/^# Eval: vendor\/model-a, prompt v1, gold set/);
  });

  it("several models: one pair of files each", async () => {
    const d = deps();
    await evalCommand(args("--model", "vendor/model-b"), d);
    expect(readdirSync(d.results)).toHaveLength(4);
  });

  it("accepts the -- that pnpm passes before the arguments", async () => {
    const d = deps();
    await evalCommand(["--", ...args()], d);
    expect(readdirSync(d.results)).toHaveLength(2);
  });

  it("the spending cap comes from config/eval.json unless --max-usd says otherwise", async () => {
    const cap = async (...extra: string[]) => {
      const d = deps();
      await evalCommand(args(...extra), d);
      const file = join(d.results, "2026-10-18-vendor-model-a-v1.json");
      return JSON.parse(readFileSync(file, "utf8")).spendingCapMicroUsd;
    };
    expect(await cap()).toBe(parseUsd(loadEvalConfig().maxUsdPerRun));
    expect(await cap("--max-usd", "0.25")).toBe(250_000);
  });
});

/** Every file in a folder, with its contents. */
const contents = (directory: string) =>
  Object.fromEntries(
    readdirSync(directory)
      .sort()
      .map((file) => [file, readFileSync(join(directory, file), "utf8")]),
  );

describe("evalCommand: repeat runs, each in its own files (#68)", () => {
  it("the first run keeps the name it always had; a second writes -run2, a third -run3", async () => {
    const d = deps();
    for (let i = 0; i < 3; i++) await evalCommand(args(), d);
    expect(readdirSync(d.results).sort()).toEqual([
      "2026-10-18-vendor-model-a-v1-run2.json",
      "2026-10-18-vendor-model-a-v1-run2.md",
      "2026-10-18-vendor-model-a-v1-run3.json",
      "2026-10-18-vendor-model-a-v1-run3.md",
      "2026-10-18-vendor-model-a-v1.json",
      "2026-10-18-vendor-model-a-v1.md",
    ]);
    const run = (name: string) =>
      JSON.parse(readFileSync(join(d.results, name), "utf8")).run;
    expect(run("2026-10-18-vendor-model-a-v1.json")).toBe(1);
    expect(run("2026-10-18-vendor-model-a-v1-run3.json")).toBe(3);
    expect(
      readFileSync(
        join(d.results, "2026-10-18-vendor-model-a-v1-run2.md"),
        "utf8",
      ),
    ).toMatch(
      /^# Eval: vendor\/model-a, prompt v1, gold set, 2026-10-18, run 2\n/,
    );
  });

  it("a results file already there is never changed: even one file alone takes its run's number", async () => {
    const d = deps();
    writeFileSync(join(d.results, "2026-10-18-vendor-model-a-v1.md"), "old");
    await evalCommand(args(), d);
    expect(readdirSync(d.results).sort()).toEqual([
      "2026-10-18-vendor-model-a-v1-run2.json",
      "2026-10-18-vendor-model-a-v1-run2.md",
      "2026-10-18-vendor-model-a-v1.md",
    ]);
    expect(
      readFileSync(join(d.results, "2026-10-18-vendor-model-a-v1.md"), "utf8"),
    ).toBe("old");
  });

  it("a file that appears while the run is going, say from another eval, isn't overwritten either", async () => {
    const d = deps();
    const md = join(d.results, "2026-10-18-vendor-model-a-v1.md");
    const { client } = fakeClient();
    const racing: OpenRouterClient = {
      complete: async (body) => {
        writeFileSync(md, "the other run's");
        return client.complete(body);
      },
    };
    await expect(evalCommand(args(), { ...d, client: racing })).rejects.toThrow(
      "EEXIST",
    );
    expect(readFileSync(md, "utf8")).toBe("the other run's");
  });

  it("each model is numbered on its own", async () => {
    const d = deps();
    await evalCommand(args(), d);
    await evalCommand(args("--model", "vendor/model-b"), d);
    expect(readdirSync(d.results).sort()).toEqual([
      "2026-10-18-vendor-model-a-v1-run2.json",
      "2026-10-18-vendor-model-a-v1-run2.md",
      "2026-10-18-vendor-model-a-v1.json",
      "2026-10-18-vendor-model-a-v1.md",
      "2026-10-18-vendor-model-b-v1.json",
      "2026-10-18-vendor-model-b-v1.md",
    ]);
  });

  it("with any number of earlier runs, the next is one more, and no file already there changes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5 }), async (earlier) => {
        const d = deps();
        for (let n = 1; n <= earlier; n++) {
          const name = `2026-10-18-vendor-model-a-v1${n === 1 ? "" : `-run${n}`}`;
          writeFileSync(join(d.results, `${name}.json`), `run ${n}`);
          writeFileSync(join(d.results, `${name}.md`), `run ${n}`);
        }
        const before = contents(d.results);
        await evalCommand(args(), d);
        const after = contents(d.results);
        const next = earlier + 1;
        const name = `2026-10-18-vendor-model-a-v1${next === 1 ? "" : `-run${next}`}`;
        expect(Object.keys(after).sort()).toEqual(
          [...Object.keys(before), `${name}.json`, `${name}.md`].sort(),
        );
        for (const [file, text] of Object.entries(before)) {
          expect(after[file]).toBe(text);
        }
        expect(JSON.parse(after[`${name}.json`]!).run).toBe(next);
      }),
      { numRuns: 12 },
    );
  });
});

describe("evalCommand: refusals, before any call", () => {
  it.each([
    [["--model", "vendor/model-a", "--prompt", "v1"], "--set"],
    [["--set", "gold", "--prompt", "v1"], "--model"],
    [["--set", "gold", "--model", "vendor/model-a"], "--prompt"],
    [args().map((a) => (a === "gold" ? "all" : a)), 'set "all"'],
  ])("missing or wrong arguments %#", async (argv, message) => {
    await expect(evalCommand(argv, deps({ client: noCalls }))).rejects.toThrow(
      message,
    );
  });

  it("a model that isn't in config/models.json: model IDs come from config", async () => {
    await expect(
      evalCommand(
        args().map((a) => (a === "vendor/model-a" ? "vendor/other" : a)),
        deps({ client: noCalls }),
      ),
    ).rejects.toThrow("vendor/other isn't in config/models.json");
  });

  it("the private set without its environment variable", async () => {
    await expect(
      evalCommand(
        args().map((a) => (a === "gold" ? "private" : a)),
        deps({ client: noCalls }),
      ),
    ).rejects.toThrow(PRIVATE_SET_VARIABLE);
  });
});

describe("evalCommand: the private set", () => {
  it("results go to the set's own results folder, every call is restricted, and the files hold no value read and no folder name", async () => {
    const directory = setFolder({ "Client Name Ltd": TEXT_PDF });
    const { client, requests } = fakeClient();
    const d = deps({ client, env: { [PRIVATE_SET_VARIABLE]: directory } });
    await evalCommand(
      args().map((a) => (a === "gold" ? "private" : a)),
      d,
    );
    expect(readdirSync(d.results)).toEqual([]);
    const written = readdirSync(join(directory, "results"));
    expect(written).toHaveLength(2);
    expect(requests[0]!.provider).toMatchObject(CLIENT_ROUTING);
    const answer = JSON.parse(goldAnswer);
    for (const file of written) {
      const text = readFileSync(join(directory, "results", file), "utf8");
      expect(text).not.toContain("Client Name");
      expect(text).not.toContain(answer.supplier.name);
      expect(text).not.toContain(answer.number);
      expect(text).not.toContain(answer.lines[0].description);
    }
  });
});

describe("checkPrivateResultsDirectory: private results never land in tracked files", () => {
  it("inside the repository, a folder Git doesn't ignore is refused", () => {
    expect(() =>
      checkPrivateResultsDirectory(join(REPO_ROOT, "docs", "x"), () => false),
    ).toThrow("inside the repository");
  });

  it("inside the repository, a git-ignored folder is fine; so is any folder outside it", () => {
    expect(() =>
      checkPrivateResultsDirectory(join(REPO_ROOT, "docs", "x"), () => true),
    ).not.toThrow();
    expect(() =>
      checkPrivateResultsDirectory(temp("outside-"), () => false),
    ).not.toThrow();
  });

  it("isIgnoredByGit asks Git", () => {
    expect(isIgnoredByGit(join(REPO_ROOT, "coverage", "eval"))).toBe(true);
    expect(isIgnoredByGit(join(REPO_ROOT, "eval", "results"))).toBe(false);
  });
});

describe("the spending cap's configuration", () => {
  it("the committed config/eval.json is valid", () => {
    expect(existsSync(EVAL_CONFIG_FILE)).toBe(true);
    expect(() => parseUsd(loadEvalConfig().maxUsdPerRun)).not.toThrow();
  });

  it("dollars become millionths exactly; anything else is refused", () => {
    expect(parseUsd("1")).toBe(1_000_000);
    expect(parseUsd("0.25")).toBe(250_000);
    expect(parseUsd("2.000001")).toBe(2_000_001);
    for (const bad of ["", "-1", "1,5", "1.0000001", "abc"]) {
      expect(() => parseUsd(bad), bad).toThrow("dollars");
    }
  });

  it("an invalid --max-usd is refused before any call", async () => {
    await expect(
      evalCommand(args("--max-usd", "1,5"), deps({ client: noCalls })),
    ).rejects.toThrow("dollars");
  });
});
