# Skill Builder

## Overview

Create well-structured Claude Code skills following established conventions and best practices. This plugin provides tooling and templates for building skills with proper YAML frontmatter, argument handling, and section structure.

- `/skill-builder:create-skill my-skill` - Create a new skill with proper structure and conventions

## Skills

| Skill                         | Description                                             |
| ----------------------------- | ------------------------------------------------------- |
| `/skill-builder:create-skill` | Create a new Claude Code skill following best practices |

## Complete Examples

### /skill-builder:create-skill

**Arguments:**

- `<skill-name>` - Name for the new skill in kebab-case (e.g., `review-code`, `analyze-deps`)
- `[context]` - Additional context about what the skill should do

**Examples:**

```bash
# Create a skill with just a name
/skill-builder:create-skill deploy-staging

# Create a skill with context
/skill-builder:create-skill review-pr A skill that reviews pull requests for code quality and security issues

# Create a skill for a specific plugin
/skill-builder:create-skill run-tests Create a skill that detects and runs the project test suite
```
