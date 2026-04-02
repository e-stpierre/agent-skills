---
name: add-task
description: Add a new task to the tasks tracking document
argument-hint: [--explore] <context>
---

# Add Task

## Overview

Add a new task entry to the tasks tracking document. This skill creates a structured task record with a unique ID, progress tracking checkbox, and detailed description section.

## Arguments

### Definitions

- **`[--explore]`** (optional): When set, analyze the codebase to add additional technical information to the task request. Defaults to `false`.
- **`<context>`** (required): Description of the task. Can include problem description, affected areas, or desired outcome.

### Values

\Arguments: $ARGUMENTS

## Configuration

The tasks document path is configured via `tasksPath` in settings or defaults to `agentic/tasks.md`.

To override in `.claude/configs/tasks.json`:

```json
{
  "tasksPath": "custom/path/tasks.md"
}
```

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
   - Check for `tasks.tasksPath` in settings
   - Default to `agentic/tasks.md` if not configured

2. **Check Document Existence**
   - If the document does not exist, create it with the template structure (see Templates section)
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

Return a JSON object summarizing the action taken:

```json
{
  "success": true,
  "task_id": "{{task_id}}",
  "title": "{{title}}",
  "document_path": "{{document_path}}",
  "explored_codebase": "{{explored}}",
  "files_identified": ["{{files_array}}"]
}
```

<!--
Placeholders:
- {{task_id}}: Generated ID (e.g., IMP-007, SEC-003)
- {{title}}: Short descriptive title of the task
- {{document_path}}: Path to the tasks document
- {{explored}}: Boolean indicating if codebase exploration was performed
- {{files_array}}: Array of file paths identified during exploration (empty if not explored)
-->

## Templates

### New Document Template

When creating a new tasks document, use this structure:

```markdown
# Tasks

This file tracks task opportunities identified during code analysis. Each task has a checklist entry for progress tracking and a detailed section explaining the issue.

## How to Use This File

1. **Adding Tasks**: Add a checkbox to the Progress Tracking section (`- [ ] IMP-XXX: Short title`) and a corresponding details section with problem description, files to investigate, and acceptance criteria.
2. **Working on Tasks**: Mark the item as in-progress by keeping `[ ]` and update the Status in the details section to "In Progress".
3. **Completing Tasks**: Change `[ ]` to `[x]` and update the Status to "Completed".
4. **Implementation**: Use `/sdlc-plan` to create an implementation plan, then implement the changes.

## Progress Tracking

<!-- Add new items here -->

## Tasks List

List the details of every task request, 100 lines maximum per item.
```

### Task Entry Template

```markdown
---

### ID: Short descriptive title

**Status**: Pending

**Problem**: Clear description of the issue or opportunity.

**Files to Investigate**:

- `path/to/file.ts` - Brief note about relevance

**Expected Behavior / Goal**: What the task should achieve.

**Acceptance Criteria**:

- [ ] First measurable criterion
- [ ] Second measurable criterion
```

<!--
Template placeholders:
- ID: The generated task ID (e.g., IMP-007)
- Short descriptive title: Brief title describing the task
- Problem description: What issue needs to be addressed
- Files to Investigate: Relevant files (discovered via exploration or provided in context)
- Expected Behavior / Goal: Desired outcome
- Acceptance Criteria: Measurable completion criteria
-->
