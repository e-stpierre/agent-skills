---
name: esp-pr
description: Create a pull request with contextual title and description
argument-hint: "[--draft] [--run-dir <path>] [base-branch]"
---

# Git PR

## Overview

Create a pull request with a title and description sized appropriately to the scope and impact of the changes using the GitHub CLI. Always includes AI attribution at the end of the body. With a run directory and `pr.body_from_run`, the body is built from the run artifacts (plan milestones, decisions, review resolution, follow-ups) instead of being written from the diff.

## Arguments

### Definitions

- **`[--draft]`** (optional): Create the PR as a draft. Defaults to `pr.draft` (`false`).
- **`[--run-dir <path>]`** (optional): Run directory of the task (from `esp-go`, `esp-build` or a harness). With `pr.body_from_run`, the body is rendered from its artifacts, and the pull request URL is recorded in its `run.json`.
- **`[base-branch]`** (optional): Target branch for the PR. Defaults to `pr.base`, or the repository default branch when `pr.base` is `null`.

### Values

Arguments: $ARGUMENTS

## Core Principles

- PR size dictates description length - small changes get small descriptions
- Title should clearly convey the primary change
- Description focuses on WHY and context, not WHAT (diff shows the what)
- Use `gh pr create` for PR creation
- Include AI attribution at the end of the body, unless `pr.attribution` is `false`
- Arguments override configuration; missing configuration falls back to the defaults below

## Skill-Specific Guidelines

### Configuration

Read the `pr` section and the shared language once at the start:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get pr
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults.language
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), continue with the defaults.

| Key                 | Default | Effect                                                                                          |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `pr.base`           | `null`  | Base branch; `null` uses the repository default branch (`gh repo view --json defaultBranchRef`) |
| `pr.draft`          | `false` | Open the PR as a draft even without `--draft`                                                   |
| `pr.attribution`    | `true`  | Append the AI attribution line to the body                                                      |
| `defaults.language` | `en-US` | Language of the PR title and body                                                               |
| `pr.body_from_run` | `true` | With `--run-dir`: build the body from the run artifacts                                        |
| `pr.body_sections` | `summary, milestones, decisions, review-resolution, follow-ups` | Sections of a body built from the run, in order |

## Instructions

1. Load the `pr` configuration (see Configuration) and resolve the base branch: the `[base-branch]` argument, else `pr.base`, else the repository default branch
2. Verify current branch is not the base branch
3. Push current branch to remote if needed
4. Fetch the latest remote base branch: `git fetch origin <base>`
5. Run `git log origin/<base>..HEAD --oneline` to get commits in this PR
6. Run `git diff origin/<base>...HEAD --stat` to assess change scope
7. Determine PR size category:
   - **Trivial**: <10 lines, single file, style/typo fix
   - **Small**: <50 lines, focused change
   - **Medium**: 50-200 lines, feature or significant fix
   - **Large**: >200 lines, major feature or refactor
8. **Body from the run** (only with `--run-dir` and `pr.body_from_run`): write a 1-2 sentence summary of why the change exists, then render the body with `node "${CLAUDE_PLUGIN_ROOT}/scripts/runs.mjs" pr-body --run-dir <path> --summary "<summary>" --out <run-dir>/pr-body.md`. It applies `pr.body_sections` and `pr.attribution`. Create the PR with `gh pr create --title "<title>" --body-file <run-dir>/pr-body.md` (add `--draft` per step 9), then go to step 11. Otherwise, construct the PR content based on size:

   **Trivial/Small**: Brief description with attribution

   ```bash
   gh pr create --title "Fix typo in README" --body "Corrects spelling error

   🤖 Generated with [Claude Code](https://claude.com/product/claude-code)"
   ```

   **Medium/Large**: Structured description with attribution

   ```bash
   gh pr create --title "<title>" --body "## Summary
   <1-2 sentence overview>

   ## Details
   - <Key change 1 with context>
   - <Key change 2 with context>

   🤖 Generated with [Claude Code](https://claude.com/product/claude-code)"
   ```

9. If the `--draft` flag is specified or `pr.draft` is `true`, add `--draft` to the gh command. Drop the attribution line when `pr.attribution` is `false`
10. Execute `gh pr create` with constructed content
11. With `--run-dir`, record the URL: `node "${CLAUDE_PLUGIN_ROOT}/scripts/runs.mjs" update --run-dir <path> --pr <url>`
12. Report the PR URL

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
