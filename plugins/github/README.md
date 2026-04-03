# GitHub

## Overview

GitHub workflow automation skills for managing pull requests. This plugin provides tools to streamline PR maintenance by automatically addressing review comments and fixing failing CI checks.

- `/github:fix-pr 42` - Fix all review comments and CI failures on PR 42

## Skills

| Skill              | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `github:fix-pr`    | Fix review comments and failing CI checks on a PR, then push fixes   |

## Complete Examples

### /github:fix-pr

**Arguments:**

- `<pr-number>` (required) - The pull request number to fix

**Examples:**

```bash
# Fix all issues on PR 42
/github:fix-pr 42
```
