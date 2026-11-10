---
name: esp-commit
description: Commit changes with a structured message
argument-hint: "[-m|--message <title>]"
---

# Git Commit

## Overview

Commit the staged changes with a concise title, an optional bullet-point description, and an AI attribution trailer naming the model.

## Arguments

### Definitions

- **`[-m|--message <title>]`** (optional): Read from `-m` or `--message`. The commit title. The plan step prefix is still added when it can be inferred (see Plan Step Reference). Defaults to a title generated from the changes.

### Values

Arguments: $ARGUMENTS

## Core Principles

- The title names the main task completed: 50 characters ideal, 120 at most
- The description is 1-5 bullets on the key aspects of a substantial change; a small change has none
- Arguments override configuration; missing configuration falls back to the defaults below

## Skill-Specific Guidelines

### Configuration

Read the `commit` section and the shared language once at the start:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get commit
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults.language
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), continue with the defaults.

| Key                       | Default | Effect                                                                                   |
| ------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `commit.style`            | `plain` | `plain`: imperative title. `conventional`: `type(scope): subject` (Conventional Commits) |
| `commit.co_author`        | `true`  | Add the `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer                 |
| `commit.plan_step_prefix` | `true`  | Add the plan step prefix (`[Task N]`, `[Milestone N]`) when following a plan             |
| `defaults.language`       | `en-US` | Language of the commit title and description                                             |

### Plan Step Reference

When actively following a plan with numbered steps and `commit.plan_step_prefix` is `true`, the title starts with the step these changes complete, in brackets:

- **Task-based plans**: `[Task N]` (e.g., `[Task 1]`, `[Task 8]`)
- **Milestone-based plans**: `[Milestone N]` when committing after completing a milestone
- **Nested plans**: `[Task M.N]` for tasks within milestones (e.g., `[Task 1.1]`, `[Task 2.3]`)

Without a plan, the title has no brackets. With `conventional` style, the prefix comes first.

**Examples:**

- `[Task 8] Update CLI with orchestrator integration`
- `[Milestone 1] Complete authentication module`
- `[Task 2] feat(auth): add token refresh`
- `Add helper function for date parsing` (no plan context)

## Instructions

1. Load the `commit` configuration (see Configuration).
2. Run `git status`. With nothing to commit, report it and stop.
3. Run `git diff --staged`; when nothing is staged, stage everything with `git add .` and read the staged diff.
4. Determine the primary purpose of the changes and their scope (small fix or larger feature), and the plan step they complete (see Plan Step Reference).
5. Construct the message in `defaults.language`:
   - **Title**: the plan step prefix (if any), then `--message` when given, otherwise per `commit.style`: imperative mood, capitalized first letter, no period (`plain`), or `type(scope): subject` (`conventional`)
   - **Description**: per Core Principles
   - **Trailer**: the `Co-Authored-By` line with your model name, unless `commit.co_author` is `false`
6. Commit with a HEREDOC so the formatting survives:

   ```bash
   git commit -m "$(cat <<'EOF'
   [Task N] <title>

   - bullet 1 (optional)
   - bullet 2 (optional)

   Co-Authored-By: Claude <model> <noreply@anthropic.com>
   EOF
   )"
   ```

7. Report the commit hash and title, read from `git log -1 --format='%h - %s'`.

## Output Guidance

Provide a brief confirmation message:

**On success:**

```text
Committed: abc123f - [Task 3] Add authentication module
```

**On error:**

```text
Failed to commit: <error message from git>
```
