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

- **`[base-branch]`** (optional): Target branch for the PR. Defaults to main/master.
- **`[--draft]`** (optional): Create the PR as a draft.

### Values

$ARGUMENTS

## Core Principles

- PR size dictates description length - small changes get small descriptions
- Title should clearly convey the primary change
- Description focuses on WHY and context, not WHAT (diff shows the what)
- Use `gh pr create` for PR creation
- Always include AI attribution at the end of the body

## Instructions

1. Verify current branch is not the base branch
2. Run `git log <base>..HEAD --oneline` to get commits in this PR
3. Run `git diff <base>...HEAD --stat` to assess change scope
4. Determine PR size category:
   - **Trivial**: <10 lines, single file, style/typo fix
   - **Small**: <50 lines, focused change
   - **Medium**: 50-200 lines, feature or significant fix
   - **Large**: >200 lines, major feature or refactor
5. Construct PR content based on size:

   **Trivial/Small**: Brief description with attribution

   ```
   gh pr create --title "Fix typo in README" --body "Corrects spelling error

   🤖 Generated with [Claude Code](https://claude.com/product/claude-code)"
   ```

   **Medium/Large**: Structured description with attribution

   ```
   gh pr create --title "<title>" --body "## Summary
   <1-2 sentence overview>

   ## Details
   - <Key change 1 with context>
   - <Key change 2 with context>

   🤖 Generated with [Claude Code](https://claude.com/product/claude-code)"
   ```

6. If `--draft` flag is specified, add `--draft` to the gh command
7. Execute `gh pr create` with constructed content
8. Report the PR URL

## Output Guidance

Return a JSON object with the following structure:

```json
{
  "success": true,
  "pr_url": "https://github.com/owner/repo/pull/123",
  "pr_number": 123,
  "title": "Add user authentication",
  "size": "medium",
  "is_draft": false,
  "message": "PR created successfully"
}
```

On error:

```json
{
  "success": false,
  "error": "Error message from gh CLI",
  "message": "Failed to create PR"
}
```
