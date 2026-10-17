// Prints eval runs side by side, from their results files (#52):
//   pnpm --filter @kitchen-ops/extract eval:compare -- <results .json>…
// Results files hold counts and field paths only, so the output never shows a value read.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { comparisonMarkdown, ResultsFile } from "../src/eval/comparison";

// pnpm runs scripts from the package folder; paths given are relative to where it was called.
const base = process.env.INIT_CWD ?? process.cwd();
const files = process.argv.slice(2).filter((arg) => arg !== "--");

try {
  if (files.length === 0)
    throw new Error("usage: eval:compare -- <results .json>…");
  const runs = files.map((file) => {
    const result = ResultsFile.safeParse(
      JSON.parse(readFileSync(resolve(base, file), "utf8")),
    );
    if (!result.success) {
      const problems = result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      throw new Error(`${file} isn't a results file: ${problems.join("; ")}`);
    }
    return result.data;
  });
  console.log(comparisonMarkdown(runs));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
