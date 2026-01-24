---
name: plan-build-validate
description: Full guided workflow from planning through implementation to validation
argument-hint: "[--git] [--pr] [--explore N] [context]"
---

# Plan-Build-Validate

## Overview

Execute the complete development workflow from planning through implementation to validation, creating a draft PR if all checks pass.

## Arguments

- **`--git`** (optional): Auto-commit throughout workflow (plan file, build checkpoints)
- **`--pr`** (optional): Create draft PR when validation passes
- **`--explore N`** (optional): Override explore agent count for planning phase
- **`[context]`** (optional): Task description to reduce prompts

## Core Principles

- This is the recommended workflow for non-trivial tasks
- Each step must complete successfully before proceeding
- Plan file is saved and can be referenced later
- PR is only created if validation passes
- Use --git to maintain atomic commits throughout
- Always run validation, regardless of --pr flag
- Fix all validation issues before creating a PR
- Review the generated plan before proceeding to build

## Command-Specific Guidelines

### Workflow Summary

Determine Task Type -> Plan (plan-chore/plan-bug/plan-feature) -> Build -> Validate -> Create PR (if --pr and passes)

**Step details:**

1. **Determine Task Type**: Analyze context or ask user (chore/bug/feature)
2. **Plan**: Execute appropriate planning command, saves plan file
3. **Build**: Implement all tasks from the plan
4. **Validate**: Run tests, code review, build verification, plan compliance
5. **Create PR**: If `--pr` flag and validation passes, create draft PR

## Instructions

### 1. Determine Task Type

- If `[context]` is provided, analyze to determine type
- Otherwise, ask user:
  - Is this a chore (maintenance task)?
  - Is this a bug fix?
  - Is this a new feature?

### 2. Execute Planning Command

Based on task type, invoke the appropriate planning command using full namespace:

- **Chore**: `/plan-chore`
- **Bug**: `/plan-bug`
- **Feature**: `/plan-feature`

Pass through:

- `--explore N` if specified
- `--git` if specified
- `[context]` if provided

Wait for plan generation to complete.

### 3. Execute Build Command

Invoke the build command with the generated plan:

```
/build <plan-file-path>
```

Pass through:

- `--git` if specified

Implement all tasks from the plan.

### 4. Execute Validate Command

Invoke the validate command:

```
/validate --plan <plan-file-path>
```

Run all validation checks:

- Tests
- Code review
- Build verification
- Plan compliance

### 5. Create PR (if --pr flag and validation passes)

If validation passes:

1. Generate PR title from plan title
2. Generate PR body from plan summary:

   ```markdown
   ## Summary

   - Key changes from the plan

   ## Test plan

   - Validation criteria from the plan

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```

3. Create draft PR using `gh pr create --draft`
4. Report PR URL to user

If validation fails:

- Report issues found
- Do not create PR
- Suggest running `/validate --autofix critical,major`

## Output Guidance

Provide progress updates at each stage and a final summary:

**During workflow:**

```
Step 1/5: Planning [COMPLETE]
- Plan saved to /specs/feature-auth.md

Step 2/5: Building [IN PROGRESS]
- Tasks: 5 completed, 3 remaining

Step 3/5: Validation [PENDING]

Step 4/5: PR Creation [PENDING]
```

**On completion:**

```
## Workflow Complete

✓ Planning: /specs/feature-auth.md
✓ Implementation: 8 tasks completed
✓ Validation: All checks passed
✓ PR Created: https://github.com/user/repo/pull/123 (draft)

Next steps:
- Review the PR
- Request reviews from team
- Address any feedback
- Mark as ready for review when complete
```

