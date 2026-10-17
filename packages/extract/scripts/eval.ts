// Runs one eval and writes its results file and summary (spec section 5):
//   pnpm --filter @kitchen-ops/extract eval -- --set gold --model <id> [--model <id>…] --prompt v1 [--max-usd 1]
// Real calls cost money: the repo owner starts every run, and only the owner runs the private set,
// found through EVAL_PRIVATE_DIR in packages/extract/.env. Prints counts and file names only.
import { evalCommand } from "../src/eval/command";

/** Today in local time, YYYY-MM-DD. */
const today = new Date().toLocaleDateString("sv-SE");

try {
  await evalCommand(process.argv.slice(2), {
    env: process.env,
    today,
    log: (line) => console.log(line),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
