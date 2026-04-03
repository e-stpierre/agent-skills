---
name: sdlc-plan
description: Create an implementation plan for a task (feature, bug fix, or chore)
argument-hint: [--git] [type] [explore-count] [path] [context]
---

# Plan

## Overview

Create a structured implementation plan for the given task. This skill explores the codebase to understand existing patterns and conventions, gathers requirements, and produces a detailed plan with actionable tasks. Supports different plan types (feature, bug, chore) with type-specific guidance.

## Arguments

### Definitions

- **`[--git]`** (optional): Commit plan file after creation.
- **`[type]`** (optional): Plan type. Values: `feature`, `bug`, `chore`, `auto`. Defaults to `auto`.
- **`[explore-count]`** (optional): Override default explore agent count. Defaults to 3 for feature, 2 for bug/chore.
- **`[path]`** (optional): Directory where the plan file is saved. Defaults to `specs`.
- **`[context]`** (optional): Freeform context for argument inference (e.g., task description, requirements).

### Values

Arguments: $ARGUMENTS

## Additional Resources

Load ONE of these based on the `[type]` argument (or detected type if auto):

- For feature plans, see [references/feature.md](references/feature.md)
- For bug fix plans, see [references/bug.md](references/bug.md)
- For chore plans, see [references/chore.md](references/chore.md)

## Core Principles

- Explore the codebase thoroughly before planning to understand existing patterns and conventions
- Generate plans as static documentation - never modify them during implementation
- Focus on specific, actionable tasks rather than time estimates or deadlines
- Use TodoWrite tool for progress tracking, not plan file updates
- Ask clarifying questions when requirements are unclear or context is insufficient
- Each task should be specific enough to execute without ambiguity
- Include file paths where changes are needed

## Instructions

1. **Parse Arguments**
   - Extract type, --explore N, --git, path, and context from arguments
   - Default type to `auto` if not specified
   - Default explore agents based on type (3 for feature, 2 for bug/chore)

2. **Detect Plan Type** (if type=auto)
   - Analyze the context to determine type:
     - **feature**: New functionality, enhancements, additions
     - **bug**: Error fixes, unexpected behavior corrections, defects
     - **chore**: Refactoring, dependency updates, maintenance, cleanup
   - Once detected, proceed with that type

3. **Load Type-Specific Guidelines**
   Based on the detected or specified type, load the corresponding reference file:
   - `feature` -> Read [references/feature.md](references/feature.md)
   - `bug` -> Read [references/bug.md](references/bug.md)
   - `chore` -> Read [references/chore.md](references/chore.md)

4. **Explore Codebase**
   - Launch explore agents (default: 3 for feature, 2 for bug/chore)
   - Focus exploration on understanding the areas relevant to the task
   - Gather context about existing patterns, conventions, and dependencies
   - Identify files and components that may be affected

5. **Gather Requirements**
   - Parse the `[context]` argument if provided
   - If requirements can be inferred from context, use them
   - Otherwise, ask the user for type-specific information (see reference file)

6. **Generate Plan**
   - Apply type-specific planning approach from the loaded reference
   - Create a plan using the structure defined in the reference file's template
   - Fill in all required sections with gathered requirements
   - List tasks in execution order

7. **Save Plan**
   - Save to `{path}/{type}-{slugified-title}.md` (path defaults to `specs`)
   - Inform user of the saved file path

8. **Git Commit (if --git flag)**
   - Stage the plan file
   - Commit with message: `docs(plan): Add {type} plan - {title}`

## Output Guidance

Present a user-friendly summary:

```
Plan saved to {path}/{type}-{slugified-title}.md

## Summary
- Type: {type}
- Title: {title}
- [Type-specific summary details]

Next steps:
- Review the plan and start implementation
```
