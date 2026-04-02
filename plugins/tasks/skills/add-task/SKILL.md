---
name: add-task
description: Add a new task to the tasks tracking document
argument-hint: [--explore] [path] <context>
---

# Add Task

## Overview

Add a new task entry to the tasks tracking document. This skill creates a structured task record with a unique ID, progress tracking checkbox, and detailed description section.

## Arguments

### Definitions

- **`[--explore]`** (optional): When set, analyze the codebase to add additional technical information to the task request. Defaults to `false`.
- **`[path]`** (optional): Where to store the task. Accepts a directory path (appends `tasks.md`) or a full path to a markdown file. Defaults to `tasks.md` at the repository root.
- **`<context>`** (required): Description of the task. Can include problem description, affected areas, or desired outcome.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the task file structure, see [task-file-template.md](references/task-file-template.md)

## Core Principles

- Create the tasks document if it doesn't exist
- Generate unique task IDs using sequential numbering
- Keep task details concise (max 100 lines per entry)
- Preserve existing tasks when adding new ones
- Use consistent formatting matching existing entries
- Use existing ID prefixes when the task type is clear (SEC, DEBT, TEST, DOC)
- Task entries should be self-contained and actionable

## Instructions

1. **Determine File Path**
   - If `[path]` is a full path to a markdown file (ends with `.md`), use it directly
   - If `[path]` is a directory, use `<path>/tasks.md`
   - If `[path]` is not provided, default to `tasks.md` at the repository root

2. **Check Document Existence**
   - If the document does not exist, create it using the structure from [task-file-template.md](references/task-file-template.md)
   - If it exists, read the current content

3. **Generate Task ID**
   - Scan existing entries to find the highest ID number
   - Generate next sequential ID in format `IMP-XXX` (e.g., `IMP-007`)
   - Use prefix based on context if clearly identifiable:
     - `SEC-XXX` for security-related tasks
     - `DEBT-XXX` for technical debt
     - `TEST-XXX` for testing tasks
     - `DOC-XXX` for documentation tasks
     - `IMP-XXX` for general tasks (default)

4. **Codebase Analysis** (if `--explore` is set)
   - Analyze the codebase to identify:
     - Relevant files and components affected
     - Existing patterns or implementations related to the task
     - Dependencies or impacts on other parts of the system
   - Include this technical context in the task details

5. **Create Task Entry**
   - Add checkbox entry to Progress Tracking section: `- [ ] ID: Short title`
   - Add detailed section to Tasks List with:
     - Status: Pending
     - Problem: Clear description of the issue or opportunity
     - Files to Investigate: Relevant file paths (if known or discovered via codebase exploration)
     - Expected Behavior / Goal: What the task should achieve
     - Acceptance Criteria: Measurable criteria for completion

6. **Write Updated Document**
   - Preserve all existing content
   - Insert new checkbox in Progress Tracking section (at the end of the list)
   - Append new details section to Tasks List

7. **Report Result**
   - Output confirmation with the new task ID
   - Show the task title and file path

## Output Guidance

Provide a brief confirmation message:

**On success:**

```
Added task IMP-007: Add retry logic to payment webhook handler
File: tasks.md
```

**On success with --explore:**

```
Added task IMP-007: Add retry logic to payment webhook handler
File: tasks.md
Files identified: src/webhooks/handler.ts, src/services/payment.ts
```

**On error:**

```
Failed to add task: <error description>
```
