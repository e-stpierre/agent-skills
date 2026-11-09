---
name: esp-branch
description: Create a branch with standardized naming convention
argument-hint: "<branch-name> [category] [issue-id] [base]"
---

# Git Branch

## Overview

Create and checkout a new branch with consistent naming that links to issue tracking when available. Uses the naming convention: `[category]/[issue-id]_[branch-name]` or `[category]/[branch-name]` when no issue ID is provided.

## Arguments

### Definitions

- **`<branch-name>`** (required): Short kebab-case description of the work.
- **`[category]`** (optional): Branch type. Common values: poc, feature, fix, chore, doc, refactor. Accepts any value. Defaults to `branch.default_category` (`feature`).
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
- Arguments override configuration; missing configuration falls back to the defaults below

## Skill-Specific Guidelines

### Configuration

Read the `branch` section once at the start:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get branch
```

If the command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), continue with the defaults.

| Key                            | Default                                   | Effect                                                 |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------ |
| `branch.pattern`               | `{category}/{issue}_{name}`               | Branch name when an issue ID is known                  |
| `branch.pattern_without_issue` | `{category}/{name}`                       | Branch name when no issue ID is known                  |
| `branch.default_category`      | `feature`                                 | Category when none is given or inferred                |
| `branch.categories`            | `feature, fix, chore, doc, refactor, poc` | Suggested categories when inferring; others still work |

## Instructions

1. Load the `branch` configuration (see Configuration)
2. Parse the provided arguments to extract category, branch-name, issue-id, and base (if present)
3. If arguments are incomplete, infer from conversation context:
   - Look for GitHub issue references (#123, issue 123)
   - Derive branch name from the task description
   - Pick the category from `branch.categories` that fits the work
4. Use the provided or inferred category, or default to `branch.default_category`
5. Determine base branch:
   - If base is provided, checkout that branch first
   - Otherwise branch from current location
6. Construct the branch name by replacing `{category}`, `{issue}` and `{name}`:
   - With issue: `branch.pattern` (default `<category>/<issue-id>_<branch-name>`)
   - Without issue: `branch.pattern_without_issue` (default `<category>/<branch-name>`)
7. Execute: `git checkout -b <constructed-branch-name>` (from base if provided)
8. Report the created branch name

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
