#!/usr/bin/env node
// Creates milestones M0–M4 and the M0/M1 issues in the current GitHub repo.
// Run once from the repo root after `gh auth login`:
//   node docs/issues/create-issues.mjs            (dry run: prints what it would do)
//   node docs/issues/create-issues.mjs --apply    (creates them)
// Safe to re-run: existing milestones and issues with the same title are skipped.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");
const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });

const MILESTONES = {
  M0: "M0. Repo and CI",
  M1: "M1. Walking skeleton",
  M2: "M2. Ledger core",
  M3: "M3. Extraction v1",
  M4: "M4. Pre-employment tag",
};

const existingMilestones = JSON.parse(
  gh(["api", "repos/{owner}/{repo}/milestones?state=all&per_page=100"]),
).map((m) => m.title);

for (const title of Object.values(MILESTONES)) {
  if (existingMilestones.includes(title)) {
    console.log(`milestone exists: ${title}`);
    continue;
  }
  console.log(`${apply ? "creating" : "would create"} milestone: ${title}`);
  if (apply)
    gh(["api", "repos/{owner}/{repo}/milestones", "-f", `title=${title}`]);
}

const existingIssues = JSON.parse(
  gh(["issue", "list", "--state", "all", "--limit", "500", "--json", "title"]),
).map((i) => i.title);

const tmp = mkdtempSync(join(tmpdir(), "ko-issues-"));
const manifest = JSON.parse(readFileSync(join(here, "issues.json"), "utf8"));

for (const { milestone, file, title } of manifest) {
  if (existingIssues.includes(title)) {
    console.log(`issue exists: ${title}`);
    continue;
  }
  // Drop the "# Title" line; GitHub shows the title separately.
  const body = readFileSync(join(here, file), "utf8").replace(
    /^# .*\r?\n\r?\n?/,
    "",
  );
  const bodyFile = join(tmp, file);
  writeFileSync(bodyFile, body);
  console.log(
    `${apply ? "creating" : "would create"} issue [${milestone}]: ${title}`,
  );
  if (apply) {
    gh([
      "issue",
      "create",
      "--title",
      title,
      "--body-file",
      bodyFile,
      "--milestone",
      MILESTONES[milestone],
    ]);
  }
}

if (!apply) console.log("\nDry run only. Re-run with --apply to create them.");
