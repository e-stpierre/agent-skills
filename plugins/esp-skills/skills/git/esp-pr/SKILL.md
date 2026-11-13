---
name: esp-pr
description: Create a pull request with contextual title and description
argument-hint: "[-w|--draft] [-b|--base <branch>] [-d|--run-dir <path>]"
---

# Git PR

## Overview

Create a pull request with the GitHub CLI, with a title and description sized to the scope and impact of the changes and an AI attribution line at the end of the body. With a run directory and `pr.body_from_run`, the body is rendered from the run artifacts (plan milestones, decisions, review resolution, follow-ups) instead of being written from the diff.

## Arguments

### Definitions

- **`[-w|--draft]`** (optional): Present as `-w` or `--draft`: create the PR as a draft. Defaults to `pr.draft` (`false`).
- **`[-b|--base <branch>]`** (optional): Read from `-b` or `--base`. Target branch of the PR. Defaults to `pr.base`, or the repository default branch when `pr.base` is `null`.
- **`[-d|--run-dir <path>]`** (optional): Read from `-d` or `--run-dir`. Run directory of the task (from `esp-ship` or a harness). With `pr.body_from_run`, the body is rendered from its artifacts, and the PR URL is recorded in its `run.json`. Defaults to none.

### Values

Arguments: $ARGUMENTS

## Core Principles

- The PR size sets the description length: a small change gets a small description
- The title conveys the primary change; the description gives the why and the context, since the diff already shows the what
- The body ends with the AI attribution line, unless `pr.attribution` is `false`
- Arguments override configuration; missing configuration falls back to the defaults below

## Skill-Specific Guidelines

### Configuration

Read the `pr` section and the shared language once at the start:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get pr
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults.language
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), continue with the defaults.

- `pr.base` (default `null`): base branch; `null` uses the repository default branch (`gh repo view --json defaultBranchRef`)
- `pr.draft` (default `false`): open the PR as a draft even without `--draft`
- `pr.attribution` (default `true`): append the AI attribution line to the body
- `defaults.language` (default `en-US`): language of the PR title and body
- `pr.body_from_run` (default `true`): with `--run-dir`, build the body from the run artifacts
- `pr.body_sections` (default `summary, milestones, decisions, review-resolution, follow-ups`): sections of a body built from the run, in order

### Size Categories

- **Trivial** (<10 lines, single file, style/typo fix): One-line description, then attribution
- **Small** (<50 lines, focused change): One-line description, then attribution
- **Medium** (50-200 lines, feature or significant fix): `## Summary` and `## Details`, then attribution
- **Large** (>200 lines, major feature or refactor): `## Summary` and `## Details`, then attribution

Trivial or small:

```bash
gh pr create --title "Fix typo in README" --body "Corrects spelling error

🤖 Generated with [Claude Code](https://claude.com/product/claude-code)"
```

Medium or large:

```bash
gh pr create --title "<title>" --body "## Summary
<1-2 sentence overview>

## Details
- <Key change 1 with context>
- <Key change 2 with context>

🤖 Generated with [Claude Code](https://claude.com/product/claude-code)"
```

## Instructions

1. Load the `pr` configuration (see Configuration) and resolve the base branch per the `--base` Definition.
2. Verify the current branch is not the base branch; when it is, report it and stop.
3. Push the current branch to the remote if it has no upstream or has unpushed commits.
4. Fetch the base and read the scope: `git fetch origin <base>`, `git log origin/<base>..HEAD --oneline`, and `git diff origin/<base>...HEAD --stat`.
5. Write the title and body in `defaults.language`:
   - **From the run** (with `--run-dir` and `pr.body_from_run`): write a 1-2 sentence summary of why the change exists, then render the body with `node "${CLAUDE_PLUGIN_ROOT}/scripts/runs.mjs" pr-body --run-dir <path> --summary "<summary>" --out <path>/pr-body.md`. It applies `pr.body_sections` and `pr.attribution`.
   - **From the diff** (otherwise): pick the size category from the stat and write the body per Size Categories. Drop the attribution line when `pr.attribution` is `false`.
6. Create the PR with `gh pr create --base <base> --title "<title>"`, plus `--body-file <path>/pr-body.md` for a body from the run or `--body "<body>"` otherwise, plus `--draft` when `-w`/`--draft` is present or `pr.draft` is `true`. Done when `gh` prints the PR URL.
7. With `--run-dir`, record the URL: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runs.mjs" update --run-dir <path> --pr <url>`.
8. Report the PR URL and title.

## Output Guidance

Provide a brief confirmation message:

**On success:**

```text
PR created: https://github.com/owner/repo/pull/123
Title: Add user authentication
```

**On error:**

```text
Failed to create PR: <error message from gh CLI>
```
