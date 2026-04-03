---
name: git-pr
description: Create a pull request with contextual title and description
argument-hint: "[--draft] [base-branch]"
---

# Git PR

## Overview

Create a pull request with a title and description sized appropriately to the scope and impact of the changes using the GitHub CLI. Always includes AI attribution at the end of the body.

## Arguments

### Definitions

- **`[--draft]`** (optional): Create the PR as a draft.
- **`[base-branch]`** (optional): Target branch for the PR. Defaults to main/master.

### Values

Arguments: $ARGUMENTS

## Core Principles

- PR size dictates description length - small changes get small descriptions
- Title should clearly convey the primary change
- Description focuses on WHY and context, not WHAT (diff shows the what)
- Use `gh pr create` for PR creation
- Always include AI attribution at the end of the body

## Instructions

1. Verify current branch is not the base branch
2. Push current branch to remote if needed
3. Fetch the latest remote base branch: `git fetch origin <base>`
4. Run `git log origin/<base>..HEAD --oneline` to get commits in this PR
5. Run `git diff origin/<base>...HEAD --stat` to assess change scope
6. Determine PR size category:
   - **Trivial**: <10 lines, single file, style/typo fix
   - **Small**: <50 lines, focused change
   - **Medium**: 50-200 lines, feature or significant fix
   - **Large**: >200 lines, major feature or refactor
7. Construct PR content based on size:

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

8. If `--draft` flag is specified, add `--draft` to the gh command
9. Execute `gh pr create` with constructed content
10. Report the PR URL

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
