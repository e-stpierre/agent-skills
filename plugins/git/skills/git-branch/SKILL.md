---
name: git-branch
description: Create a branch with standardized naming convention
argument-hint: "<branch-name> [category] [issue-id] [base]"
---

# Git Branch

## Overview

Create and checkout a new branch with consistent naming that links to issue tracking when available. Uses the naming convention: `[category]/[issue-id]_[branch-name]` or `[category]/[branch-name]` when no issue ID is provided.

## Arguments

### Definitions

- **`<branch-name>`** (required): Short kebab-case description of the work.
- **`[category]`** (optional): Branch type. Common values: poc, feature, fix, chore, doc, refactor. Accepts any value. Defaults to `feature`.
- **`[issue-id]`** (optional): GitHub issue number associated with this work.
- **`[base]`** (optional): Base branch to create from. If not provided, branch from current location.

### Values

Arguments: $ARGUMENTS

## Core Principles

- Use kebab-case for branch names (lowercase, hyphens)
- Keep branch names concise but descriptive
- Include issue ID when context provides one
- Never prompt interactively - extract from context or use defaults
- Accept any category value provided

## Instructions

1. Parse the provided arguments to extract category, branch-name, issue-id, and base (if present)
2. If arguments are incomplete, infer from conversation context:
   - Look for GitHub issue references (#123, issue 123)
   - Derive branch name from the task description
   - Default category to `feature` if not provided
3. Use the provided category or default to `feature`. Common categories: poc, feature, fix, chore, doc, refactor
4. Determine base branch:
   - If base is provided, checkout that branch first
   - Otherwise branch from current location
5. Construct the branch name:
   - With issue: `<category>/<issue-id>_<branch-name>`
   - Without issue: `<category>/<branch-name>`
6. Execute: `git checkout -b <constructed-branch-name>` (from base if provided)
7. Report the created branch name

## Output Guidance

Provide a brief confirmation message:

**On success:**

```text
Created and switched to branch: feature/123_add-authentication
```

**On error:**

```text
Failed to create branch: <error message from git>
```
