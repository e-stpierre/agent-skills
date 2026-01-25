---
name: one-shot
description: Quick task execution without a saved plan file. Ideal for small, well-defined tasks
argument-hint: "[--git] [--pr] [--validate] [--explore N] [context]"
---

# One-Shot

## Overview

Execute small, well-defined tasks quickly without creating a saved plan file, optimizing for speed over thoroughness.

## Arguments

- **`--git`** (optional): Auto-commit changes when done
- **`--pr`** (optional): Create a draft PR after completion (implies --git)
- **`--validate`** (optional): Run validation after implementation
- **`--explore N`** (optional): Override explore agent count (default: 0 for speed)
- **`[context]`** (optional): Task description

## Core Principles

- Optimized for speed - minimal exploration by default
- No plan file is saved - use full planning workflow for documented work
- Task must be well-defined and small in scope
- Ask clarifying questions if task is unclear
- Use --validate for critical or security-related changes to catch issues
- Use full planning workflow for complex features, bugs requiring deep investigation, large refactoring, or unclear requirements

## Command-Specific Guidelines

### When to Use One-Shot

**Good for:**

- Typo fixes
- Simple bug fixes with clear root cause
- Small refactoring tasks
- Adding minor functionality
- Quick code cleanup

**Not recommended for:**

- Complex features requiring architecture decisions
- Bugs requiring deep investigation
- Tasks with unclear requirements
- Large refactoring efforts

For complex tasks, use the full planning workflow instead.

## Instructions

1. **Parse Task**
   - Analyze the `[context]` to understand the task
   - Determine task type (chore/bug/feature)
   - Extract key requirements

2. **Quick Exploration (if --explore N > 0)**
   - Launch N explore agents
   - Focus on immediately relevant code areas
   - Skip for simple tasks

3. **Create In-Memory Plan**
   - Generate a lightweight plan internally
   - Do NOT save plan to file
   - Structure depends on task type:
     - Chore: tasks and validation
     - Bug: root cause, fix strategy, testing
     - Feature: minimal milestones and tasks

4. **Create Branch (if --git or --pr flag)**
   - Use `/git-branch` to create a new branch
   - Branch category based on task type (fix/feature/chore)
   - Branch name derived from task description

5. **Implement**
   - Create todo list from in-memory plan
   - Implement each task sequentially
   - Mark todos as completed
   - Ask clarifying questions if needed

6. **Git Commit (if --git or --pr flag)**
   - Use `/git-commit` to commit changes

7. **Validate (if --validate flag)**
   - Run `/validate`
   - Report any issues found

8. **Create PR (if --pr flag)**
   - Use `/git-pr --draft` to create a draft PR

## Output Guidance

Provide a concise summary of what was done:

```
## Task Complete

Changes made:
- [list of changes]

Files modified: X
Committed: Yes/No
PR created: <URL> (if --pr used)

[If --validate used:]
Validation results: PASS/FAIL
- Tests: PASS
- Build: PASS
- Review: No critical issues
```
