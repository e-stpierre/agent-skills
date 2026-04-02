# Tasks

## Overview

Task tracking plugin for managing improvement opportunities, bugs, debt, and other actionable items in a structured markdown document. Provides sequential ID generation, progress tracking, and optional codebase analysis.

- `/add-task Fix error handling in auth module` - Add a task with context
- `/add-task --explore Improve database query performance` - Add a task with codebase analysis

## Skills

| Skill       | Description                                    |
| ----------- | ---------------------------------------------- |
| `/add-task` | Add a new task to the tasks tracking document  |

## Complete Examples

### /add-task

**Arguments:**

- `[--explore]` - Analyze codebase for additional technical context
- `[path]` - Where to store the task. Accepts a directory or full `.md` path. Defaults to `tasks.md` at repository root
- `<context>` - Description of the task (required)

**Examples:**

```bash
# Add a general task
/add-task Fix error handling in auth module

# Add a task with codebase exploration
/add-task --explore Improve database query performance

# Add a task to a specific file
/add-task docs/backlog.md Add API rate limiting documentation

# Add a task to a specific directory (creates tasks.md in that directory)
/add-task --explore src/api/ Refactor authentication middleware

# Add a security task (auto-prefixed SEC-XXX)
/add-task Review input validation for API endpoints

# Add a documentation task (auto-prefixed DOC-XXX)
/add-task Update API documentation for new endpoints
```
