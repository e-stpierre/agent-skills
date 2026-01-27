---
name: plan-build-validate
description: Full guided workflow from planning through implementation to validation
argument-hint: "[--git] [--pr] [--explore N] [context]"
---

# Plan-Build-Validate

## Overview

Execute the complete development workflow from planning through implementation to validation, creating a draft PR if all checks pass.

## Arguments

### Definitions

- **`[--git]`** (optional): Auto-commit throughout workflow (plan file, build checkpoints)
- **`[--pr]`** (optional): Create draft PR when validation passes
- **`[--explore N]`** (optional): Override explore agent count for planning phase
- **`[context]`** (optional): Task description to reduce prompts

### Values

$ARGUMENTS

## Core Principles

- This is the recommended workflow for non-trivial tasks
- Each step must complete successfully before proceeding
- Plan file is saved and can be referenced later
- PR is only created if validation passes
- Use --git to maintain atomic commits throughout
- Always run validation, regardless of --pr flag
- Fix all validation issues before creating a PR
- Review the generated plan before proceeding to build

## Skill-Specific Guidelines

### Workflow Summary

Determine Task Type -> Plan -> Create Branch -> Commit Plan -> Build -> Validate -> Create PR (if --pr and passes)

**Step details:**

1. **Determine Task Type**: Analyze context or ask user (chore/bug/feature)
2. **Plan**: Execute appropriate planning skill, saves plan file
3. **Create Branch**: Create a new branch using `/git-branch` (if --git or --pr)
4. **Commit Plan**: Commit the plan file using `/git-commit` (if --git or --pr)
5. **Build**: Implement all tasks from the plan
6. **Validate**: Run tests, code review, build verification, plan compliance
7. **Create PR**: If `--pr` flag and validation passes, create draft PR using `/git-pr`

## Instructions

### 1. Determine Task Type

- If `[context]` is provided, analyze to determine type
- Otherwise, ask user:
  - Is this a chore (maintenance task)?
  - Is this a bug fix?
  - Is this a new feature?

### 2. Execute Planning Skill

Based on task type, invoke the planning skill:

```
/sdlc-plan <type>
```

Where `<type>` is one of: `chore`, `bug`, or `feature`.

Pass through:

- `--explore N` if specified
- `[context]` if provided

Wait for plan generation to complete.

### 3. Create Branch (if --git or --pr flag)

Use `/git-branch` to create a new branch:

- Branch category based on task type (fix/feature/chore)
- Branch name derived from the plan title

### 4. Commit Plan (if --git or --pr flag)

Use `/git-commit` to commit the plan file with a message like:

- `docs: Add implementation plan for <feature>`

### 5. Execute Build Skill

Invoke the build skill with the generated plan:

```
/build <plan-file-path>
```

Pass through:

- `--git` if specified

Implement all tasks from the plan.

### 6. Execute Review Skill

Invoke the review skill:

```
/sdlc-review --plan <plan-file-path>
```

Run all validation checks:

- Tests
- Code review
- Build verification
- Plan compliance

### 7. Create PR (if --pr flag and validation passes)

If validation passes:

- Use `/git-pr --draft` to create a draft PR
- Report PR URL to user

If validation fails:

- Report issues found
- Do not create PR
- Suggest running `/sdlc-review --autofix critical,major`

## Output Guidance

Provide progress updates at each stage and a final summary.

**During workflow:**

```
Step 1/7: Planning [COMPLETE]
- Plan saved to /specs/feature-auth.md

Step 2/7: Create Branch [COMPLETE]
- Created branch: feature/add-auth

Step 3/7: Commit Plan [COMPLETE]

Step 4/7: Building [IN PROGRESS]
- Tasks: 5 completed, 3 remaining

Step 5/7: Validation [PENDING]

Step 6/7: PR Creation [PENDING]
```

**On completion:**

```
## Workflow Complete

✓ Planning: /specs/feature-auth.md
✓ Branch: feature/add-auth
✓ Plan committed
✓ Implementation: 8 tasks completed
✓ Validation: All checks passed
✓ PR Created: https://github.com/user/repo/pull/123 (draft)

Next steps:
- Review the PR
- Request reviews from team
- Address any feedback
- Mark as ready for review when complete
```
