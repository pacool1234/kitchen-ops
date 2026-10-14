# kitchen-ops starter pack

Copy everything in this folder into the root of your `kitchen-ops` repo (keep the folder structure), then delete this file.

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | Loaded by Claude Code in every session: commands, layout, hard rules, session workflow |
| `.claude/rules/ledger.md` | Loaded only when Claude works in `packages/ledger/` |
| `.claude/rules/extract.md` | Loaded only when Claude works in `packages/extract/` or `eval/` |
| `.claude/settings.json` | Deny rules plus a hook that blocks any access to `eval/private/` and any commit that stages it |
| `.claude/hooks/guard-private.mjs` | The hook script (runs with Node, works on Windows) |
| `docs/spec.md` | The spec. From now on this file is the source of truth, not the Claude Doc |
| `docs/decisions/` | One record per decision, with the reasons |
| `docs/issues/` | Drafts of the 11 M0–M1 issues and a script to create them |

## Steps

1. Copy the files in and commit them on `main`:
   `git add . ; git commit -m "docs: add Claude Code setup, spec and decision records" ; git push`
2. Install and log in to the GitHub CLI if you haven't: `winget install GitHub.cli`, then `gh auth login`.
3. Preview the issues, then create them:
   `node docs/issues/create-issues.mjs` (dry run), then `node docs/issues/create-issues.mjs --apply`
4. Start Claude Code in the repo root and run `/context`: `CLAUDE.md` should be listed under memory files. Run `/hooks` to see the guard hook.
5. First session: "Work on issue #1. Read it with gh, then propose a plan before writing code."

Issue #1 overlaps with what you already did by hand; Claude Code should check the current state and only do what's missing.
