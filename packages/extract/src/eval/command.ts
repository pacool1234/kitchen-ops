import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadModels, type ModelConfig } from "../llm/config";
import { openRouterFromEnv, type OpenRouterClient } from "../llm/openrouter";
import { loadPrompt } from "../llm/prompts";
import {
  formatRatio,
  formatUsd,
  resultsFileName,
  resultsJson,
  summaryMarkdown,
  type RunInfo,
} from "./report";
import { runEval } from "./run";
import { loadSet, SET_NAMES, type SetName } from "./sets";

// The eval command (spec section 5): one model and prompt combination, or several models, over a
// set, writing a results file and a Markdown summary per model. The repo owner starts every real
// run; tests pass a fake client.
//   pnpm --filter @kitchen-ops/extract eval -- --set gold --model <id> [--model <id>…] --prompt v1 [--max-usd 1]

export const REPO_ROOT = fileURLToPath(
  new URL("../../../../", import.meta.url),
);

/** `packages/extract/config/eval.json`: the default spending cap. */
export const EVAL_CONFIG_FILE = new URL(
  "../../config/eval.json",
  import.meta.url,
);

const USD = /^(\d+)(?:\.(\d{1,6}))?$/;

const EvalConfig = z.strictObject({
  /** Dollars, as text: "1.00". The monthly budget (spec section 7) covers OpenRouter too. */
  maxUsdPerRun: z.string().regex(USD),
});

export function loadEvalConfig(file: URL = EVAL_CONFIG_FILE) {
  return EvalConfig.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Dollars as text ("0.25") to millionths, exactly. */
export function parseUsd(text: string): number {
  const match = USD.exec(text);
  if (!match) {
    throw new Error(
      `a spending cap is dollars like 0.50, with at most 6 decimals; got ${JSON.stringify(text)}`,
    );
  }
  const [, whole = "0", fraction = ""] = match;
  return Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
}

/** Whether Git ignores `path` in this repository. */
export function isIgnoredByGit(path: string): boolean {
  return (
    spawnSync("git", ["check-ignore", "-q", "--", path], { cwd: REPO_ROOT })
      .status === 0
  );
}

/**
 * Private results must never land in the repository's tracked files: a results folder inside the
 * repository must be one Git ignores. The message doesn't show the path, which may name a client.
 */
export function checkPrivateResultsDirectory(
  directory: string,
  ignored: (path: string) => boolean = isIgnoredByGit,
): void {
  const path = resolve(directory);
  const fromRoot = relative(REPO_ROOT, path);
  const inside = !fromRoot.startsWith("..") && !isAbsolute(fromRoot);
  if (inside && !ignored(path)) {
    throw new Error(
      "the private set's results folder is inside the repository and Git doesn't ignore it: keep the private set outside the repository or in a git-ignored folder",
    );
  }
}

export interface CommandDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The run's date, YYYY-MM-DD. */
  readonly today: string;
  /** Default: OpenRouter with the key from the environment. */
  readonly client?: OpenRouterClient;
  readonly now?: () => number;
  readonly modelsFile?: URL;
  readonly evalConfigFile?: URL;
  readonly goldDirectory?: URL;
  readonly resultsDirectory?: URL;
  readonly isIgnoredByGit?: (path: string) => boolean;
  readonly log?: (line: string) => void;
}

const USAGE =
  "usage: eval -- --set gold|private --model <id> [--model <id>…] --prompt v1 [--max-usd 1]";

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is required. ${USAGE}`);
  return value;
}

/** Runs the command. Returns the files written. Throws, before any call, on anything wrong. */
export async function evalCommand(
  argv: readonly string[],
  deps: CommandDeps,
): Promise<string[]> {
  const log = deps.log ?? (() => {});
  const { values } = parseArgs({
    args: argv[0] === "--" ? argv.slice(1) : [...argv],
    options: {
      set: { type: "string" },
      model: { type: "string", multiple: true },
      prompt: { type: "string" },
      "max-usd": { type: "string" },
    },
  });

  const setName = required(values.set, "--set");
  if (!(SET_NAMES as readonly string[]).includes(setName)) {
    throw new Error(`there is no set "${setName}". ${USAGE}`);
  }
  const ids = required(values.model, "--model");
  const prompt = loadPrompt(required(values.prompt, "--prompt"));
  const configured = loadModels(deps.modelsFile);
  const models = ids.map((id): ModelConfig => {
    const model = configured.find((m) => m.id === id);
    if (model === undefined) {
      throw new Error(`model ${id} isn't in config/models.json`);
    }
    return model;
  });
  const maxMicroUsd = parseUsd(
    values["max-usd"] ?? loadEvalConfig(deps.evalConfigFile).maxUsdPerRun,
  );

  const set = loadSet(setName as SetName, deps.env, {
    ...(deps.goldDirectory ? { goldDirectory: deps.goldDirectory } : {}),
    ...(deps.resultsDirectory
      ? { resultsDirectory: deps.resultsDirectory }
      : {}),
  });
  if (set.name === "private") {
    checkPrivateResultsDirectory(set.resultsDirectory, deps.isIgnoredByGit);
  }

  // Each model's run takes the first number with neither file there yet (#68). Writing with
  // `wx` below still refuses to replace a file, so a run already there is never changed.
  const taken = (name: string) =>
    existsSync(join(set.resultsDirectory, `${name}.json`)) ||
    existsSync(join(set.resultsDirectory, `${name}.md`));
  const infos = models.map((model): RunInfo => {
    const info = {
      date: deps.today,
      set: set.name,
      prompt: prompt.version,
      maxMicroUsd,
    };
    let runNumber = 1;
    while (taken(resultsFileName({ ...info, runNumber }, model))) runNumber++;
    return { ...info, runNumber };
  });

  const client = deps.client ?? openRouterFromEnv(deps.env);
  const runs = await runEval({
    set,
    models,
    prompt,
    client,
    maxMicroUsd,
    today: deps.today,
    ...(deps.now ? { now: deps.now } : {}),
  });

  mkdirSync(set.resultsDirectory, { recursive: true });
  const written: string[] = [];
  for (const [i, run] of runs.entries()) {
    // runEval returns one run per model, in the order given.
    const info = infos[i]!;
    const name = resultsFileName(info, run.model);
    const json = join(set.resultsDirectory, `${name}.json`);
    const md = join(set.resultsDirectory, `${name}.md`);
    writeFileSync(
      json,
      `${JSON.stringify(resultsJson(run, info), null, 2)}\n`,
      {
        flag: "wx",
      },
    );
    writeFileSync(md, summaryMarkdown(run, info), { flag: "wx" });
    written.push(json, md);
    // Counts only: never a value read.
    log(
      `${run.model.id}: silent errors ${formatRatio(run.summary.silentErrorRate)}, review ${formatRatio(run.summary.reviewRate)}, spent ${formatUsd(run.summary.cost.totalMicroUsd)}${run.stoppedBecause ? ` (stopped: ${run.stoppedBecause})` : ""}`,
    );
  }
  for (const file of written) log(`wrote ${relative(REPO_ROOT, file)}`);
  return written;
}
