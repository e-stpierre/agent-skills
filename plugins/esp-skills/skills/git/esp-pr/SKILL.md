---
name: esp-pr
description: Create a pull request with contextual title and description
argument-hint: "[--draft] [base-branch]"
---

# Git PR

## Overview

Create a pull request with a title and description sized appropriately to the scope and impact of the changes using the GitHub CLI. Always includes AI attribution at the end of the body.

## Arguments

### Definitions

- **`[--draft]`** (optional): Create the PR as a draft. Defaults to `pr.draft` (`false`).
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

`pr.body_from_run` and `pr.body_sections` are reserved for building the body from run artifacts and are not read yet.

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
8. Construct PR content based on size:

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
11. Report the PR URL

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
