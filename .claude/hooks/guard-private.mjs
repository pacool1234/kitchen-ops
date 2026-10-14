#!/usr/bin/env node
// PreToolUse guard: keeps Claude Code away from client data in eval/private/.
// - Denies any tool call whose input mentions eval/private (read, list, grep, edit, shell).
// - Before `git commit`, denies if anything under eval/private/ is staged.
// Exit 0 with no output = no decision (normal permission flow applies).
import { execSync } from "node:child_process";

const PRIVATE = /eval[\\/]+private/i;

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Unparseable input: fail closed.
    deny("guard-private: could not parse hook input; refusing to be safe.");
  }
  const toolInput = input.tool_input ?? {};
  const text = JSON.stringify(toolInput);

  if (PRIVATE.test(text)) {
    deny(
      "eval/private/ holds client documents. Claude must not read, list, search, copy or commit it. Ask the repo owner to run anything that needs it.",
    );
  }

  const command =
    typeof toolInput.command === "string" ? toolInput.command : "";
  if (/\bgit\b[^\n]*\bcommit\b/.test(command)) {
    try {
      const staged = execSync("git diff --cached --name-only", {
        cwd: input.cwd || process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const bad = staged.split(/\r?\n/).filter((f) => PRIVATE.test(f));
      if (bad.length > 0) {
        deny(
          `Refusing to commit: ${bad.length} staged file(s) under eval/private/. Unstage them with \`git restore --staged eval/private\`.`,
        );
      }
    } catch {
      // Not a git repo or git unavailable: nothing staged to check.
    }
  }
  process.exit(0);
});
