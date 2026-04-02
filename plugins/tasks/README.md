# Tasks

## Overview

Task tracking plugin for managing improvement opportunities, bugs, debt, and other actionable items in a structured markdown document. Provides sequential ID generation, progress tracking, and optional codebase analysis.

- `/add-task Fix error handling in auth module` - Add a task with context
- `/add-task --explore Improve database query performance` - Add a task with codebase analysis

## Skills

| Skill       | Description                                    |
| ----------- | ---------------------------------------------- |
| `/add-task` | Add a new task to the tasks tracking document  |

## Configuration

Configure in `.claude/configs/tasks.json`:

```json
{
  "tasksPath": "agentic/tasks.md"
}
```

### Configuration Options

| Setting     | Type   | Default              | Description                    |
| ----------- | ------ | -------------------- | ------------------------------ |
| `tasksPath` | string | `"agentic/tasks.md"` | Path to the tasks document     |

## Complete Examples

### /add-task

**Arguments:**

- `[--explore]` - Analyze codebase for additional technical context
- `<context>` - Description of the task (required)

**Examples:**

```bash
# Add a general task
/add-task Fix error handling in auth module

# Add a task with codebase exploration
/add-task --explore Improve database query performance

# Add a security task (auto-prefixed SEC-XXX)
/add-task Review input validation for API endpoints

# Add a documentation task (auto-prefixed DOC-XXX)
/add-task Update API documentation for new endpoints
```
