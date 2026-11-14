---
name: esp-branch
description: Create a git branch named by the configured convention. Use when starting work that needs a new branch.
argument-hint: "[-s|--slug <slug>] [-t|--type <type>] [-g|--issue <id>] [-b|--base <branch>]"
---

# Git Branch

## Overview

Create and check out a new branch whose name follows the configured pattern and links to the issue when one is known: `<type>/<issue>_<slug>`, or `<type>/<slug>` without an issue.

## Arguments

### Definitions

- **`[-s|--slug <slug>]`** (optional): Read from `-s` or `--slug`. Defaults to a slug derived from the task in the conversation.
- **`[-t|--type <type>]`** (optional): Read from `-t` or `--type`. Branch type (the `{category}` of the pattern). Common values: `poc`, `feature`, `fix`, `chore`, `doc`, `refactor`; any value is accepted. Defaults to the type inferred from the work, else `branch.default_category` (`feature`).
- **`[-g|--issue <id>]`** (optional): Read from `-g` or `--issue`. GitHub issue number of this work. Defaults to an issue referenced in the conversation (`#123`, `issue 123`), else none.
- **`[-b|--base <branch>]`** (optional): Read from `-b` or `--base`. Branch to create from. Defaults to the current location.

### Values

Arguments: $ARGUMENTS

## Core Principles

- Run without prompting: every missing value comes from the conversation or the defaults
- The slug is a concise kebab-case summary of the work, three to five words

## Skill-Specific Guidelines

### Configuration

Read the `branch` section once at the start:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get branch
```

If the command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), continue with the defaults.

- `branch.pattern` (default `{category}/{issue}_{name}`): branch name when an issue ID is known
- `branch.pattern_without_issue` (default `{category}/{name}`): branch name when no issue ID is known
- `branch.default_category` (default `feature`): type when none is given or inferred
- `branch.categories` (default `feature, fix, chore, doc, refactor, poc`): suggested types when inferring; other `--type` values work

## Instructions

1. Load the `branch` configuration (see Configuration).
2. Resolve the slug, type, issue and base from the options, filling each missing one per its Definition (pick an inferred type from `branch.categories`).
3. Build the name: replace `{category}` with the type, `{issue}` with the issue and `{name}` with the slug in `branch.pattern` when an issue is known, else in `branch.pattern_without_issue`.
4. Create it: with a base, `git checkout -b <name> <base>`; otherwise `git checkout -b <name>`. Done when `git branch --show-current` prints the new name.
5. Report the created branch name.

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
