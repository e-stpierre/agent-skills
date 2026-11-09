---
name: esp-commit
description: Commit changes with a structured message
argument-hint: "[message]"
---

# Git Commit

## Overview

Create a well-structured commit with a concise title and optional bullet-point description for staged changes. Always includes AI attribution with the model name.

## Arguments

### Definitions

- **`[message]`** (optional): Override commit title. If not provided, auto-generate from changes.

### Values

Arguments: $ARGUMENTS

## Core Principles

- Title must be short (50 chars ideal, 120 max) and focus on the main task completed
- Description is optional for small commits
- Description uses 1-5 bullet points for larger commits highlighting important aspects
- Include AI attribution with your model name: `Co-Authored-By: Claude <model> <noreply@anthropic.com>`, unless `commit.co_author` is `false`
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
| `commit.co_author`        | `true`  | Add the `Co-Authored-By` trailer                                                         |
| `commit.plan_step_prefix` | `true`  | Add the plan step prefix (`[Task N]`, `[Milestone N]`) when following a plan             |
| `defaults.language`       | `en-US` | Language of the commit title and description                                             |

With `conventional` style and a plan step, the prefix comes first: `[Task 2] feat(auth): add token refresh`.

### Plan Step Reference

When following a plan (implementation plan, milestone plan, etc.), include the current step reference at the start of the commit title in brackets:

- **Task-based plans**: `[Task N]` where N is the task number (e.g., `[Task 1]`, `[Task 8]`)
- **Milestone-based plans**: `[Milestone N]` when committing after completing a milestone
- **Nested plans**: `[Task M.N]` for tasks within milestones (e.g., `[Task 1.1]`, `[Task 2.3]`)

Only include this prefix if you are actively following a plan with numbered steps. If no plan context exists, omit the brackets entirely.

**Examples:**

- `[Task 8] Update CLI with orchestrator integration`
- `[Milestone 1] Complete authentication module`
- `[Task 2.3] Add unit tests for validation logic`
- `Add helper function for date parsing` (no plan context)

## Instructions

1. Load the `commit` configuration (see Configuration)
2. Run `git status` to verify there are changes to commit
3. Run `git diff --staged` to analyze staged changes (if none, stage all with `git add .`)
4. Analyze the changes to determine:
   - Primary purpose of the changes (the "what")
   - Impact and scope (small fix vs. larger feature)
5. Determine plan step reference (if following a plan and `commit.plan_step_prefix` is `true`):
   - Check if there is an active plan with numbered tasks or milestones
   - Identify which task/milestone these changes correspond to
   - Format the prefix accordingly (e.g., `[Task 3]`, `[Milestone 2]`, `[Task 1.2]`)
6. Construct commit message:
   - **Title**: `[Step Ref]` prefix (if applicable), then per `commit.style`: imperative mood with a capitalized first letter and no period (`plain`), or `type(scope): subject` (`conventional`)
   - **Description**: Only if changes are substantial; 1-5 bullets on key aspects
   - **Trailer**: the `Co-Authored-By` line, unless `commit.co_author` is `false`
7. Execute commit using HEREDOC for proper formatting:

   ```bash
   git commit -m "$(cat <<'EOF'
   [Task N] <title>

   - bullet 1 (optional)
   - bullet 2 (optional)

   Co-Authored-By: Claude <model> <noreply@anthropic.com>
   EOF
   )"
   ```

8. Report success with commit hash

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
