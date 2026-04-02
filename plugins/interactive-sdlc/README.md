# Interactive SDLC Plugin

## Overview

Human-in-the-loop plugin for guided development within Claude Code sessions. Provides interactive planning, validation, and analysis workflows with smart context inference. All skills support optional context arguments to reduce prompts while maintaining the ability to ask clarifying questions.

- `/sdlc-plan feature Add OAuth login` - Plan a feature with milestones
- `/sdlc-review --plan specs/feature-auth.md` - Review implementation
- `/analyze security` - Analyze codebase for issues

## Skills

Skills are organized into logical categories. All paths are relative to `plugins/interactive-sdlc/skills/`.

### Planning

| Skill        | Description                                            |
| ------------ | ------------------------------------------------------ |
| `/sdlc-plan` | Create an implementation plan (feature, bug, or chore) |

### Development

| Skill          | Description                                                           |
| -------------- | --------------------------------------------------------------------- |
| `/sdlc-review` | Comprehensive validation (tests, code review, build, plan compliance) |

### Analysis

| Skill      | Description                                               |
| ---------- | --------------------------------------------------------- |
| `/analyze` | Analyze codebase for bugs, debt, docs, security, or style |

### GitHub

| Skill              | Description                                       |
| ------------------ | ------------------------------------------------- |
| `/create-gh-issue` | Create GitHub issues with title, body, and labels |
| `/read-gh-issue`   | Read GitHub issue content by number               |

## Arguments Reference

### Common Arguments

- `[explore-count]` - Override default explore agent count for codebase analysis
- `[context]` - Optional freeform context as the last parameter

### Review-Specific Arguments

- `[plan-file]` - Plan file to verify compliance against
- `[autofix-levels]` - Auto-fix issues of specified severity levels (e.g., "critical,major")
- `--skip-tests` - Skip test execution
- `--skip-build` - Skip build verification
- `--skip-review` - Skip code review

## Context Argument

All skills support an optional `[context]` argument as the last parameter. This allows you to provide upfront information that would otherwise require interactive questions.

**Benefits:**

- Faster workflow by providing all information upfront
- Better for automation and scripting
- Reduced friction with fewer interactive prompts
- Flexibility to choose between interactive or context mode

**Example:**

```bash
# With context - minimal prompts
/sdlc-plan bug --explore 3 "Login fails on Safari when using OAuth. Users click login button, get redirected to OAuth provider, but after successful auth they are redirected to a blank page instead of the dashboard."

# Without context - interactive prompts
/sdlc-plan bug --explore 3
```

## Plan File Principles

Plans are static documentation of work to be done:

- Plans are immutable during implementation (progress tracked via TodoWrite)
- No time estimates, deadlines, or scheduling information
- Content includes requirements, architecture, tasks, and validation criteria
- Implementation skills read plans as reference, not as mutable state

## Configuration

Configure the plugin in `.claude/configs/interactive-sdlc.json` (project scope, committed to git if not included in .gitignore):

```json
{
  "planDirectory": "specs",
  "analysisDirectory": "analysis",
  "defaultExploreAgents": {
    "chore": 2,
    "bug": 2,
    "feature": 3
  }
}
```

### Configuration Options

| Setting                        | Type          | Default      | Description                          |
| ------------------------------ | ------------- | ------------ | ------------------------------------ |
| `planDirectory`                | string        | `"specs"`    | Directory for plan files (.md)       |
| `analysisDirectory`            | string        | `"analysis"` | Directory for analysis reports (.md) |
| `defaultExploreAgents.chore`   | number (0-5)  | `2`          | Explore agents for chore planning    |
| `defaultExploreAgents.bug`     | number (0-5)  | `2`          | Explore agents for bug planning      |
| `defaultExploreAgents.feature` | number (0-10) | `3`          | Explore agents for feature planning  |

## Complete Examples

### /sdlc-plan

**Arguments:**

- `[type]` - Plan type: `feature`, `bug`, `chore`, or `auto` (default: `auto`)
- `[explore-count]` - Override default explore agent count
- `--git` - Commit plan file after creation
- `[context]` - Task description

**Examples:**

```bash
# Plan a feature with context
/sdlc-plan feature Add user authentication with OAuth for Google and GitHub

# Plan a bug fix
/sdlc-plan bug Login fails on Safari when using OAuth

# Plan a chore
/sdlc-plan chore Update all npm dependencies to latest versions

# Auto-detect type from context
/sdlc-plan Fix the login timeout issue

# Plan with exploration and commit
/sdlc-plan feature 5 --git Implement real-time notifications
```

### /sdlc-review

**Arguments:**

- `[plan-file]` - Plan file to verify compliance
- `[autofix-levels]` - Auto-fix issues (e.g., "critical,major")
- `--skip-tests` - Skip test execution
- `--skip-build` - Skip build verification
- `--skip-review` - Skip code review

**Examples:**

```bash
# Full validation with plan
/sdlc-review specs/feature-auth.md

# Skip tests, auto-fix critical
/sdlc-review --skip-tests critical

# Quick validation
/sdlc-review --skip-tests --skip-build
```

### /analyze

**Arguments:**

- `<type>` - Analysis type: `bug`, `debt`, `doc`, `security`, or `style` (required)
- `[context]` - Focus areas or directories to analyze

**Examples:**

```bash
# Bug analysis
/analyze bug
/analyze bug Focus on error handling in API routes
/analyze bug src/api/ src/services/

# Documentation analysis
/analyze doc
/analyze doc Check API documentation accuracy

# Technical debt analysis
/analyze debt
/analyze debt Focus on database access patterns

# Style analysis
/analyze style
/analyze style Check naming conventions in React components

# Security analysis
/analyze security
/analyze security Focus on authentication and session management
```

### /create-gh-issue

**Arguments:**

- `<title>` - Issue title (required)
- `[body]` - Issue body/description
- `[labels]` - Comma-separated list of labels
- `[milestone]` - Milestone to assign
- `[assignee]` - GitHub username (use `@me` for self)

**Examples:**

```bash
# Simple issue
/create-gh-issue "Fix login bug"

# With body and labels
/create-gh-issue "Fix login bug" "Users cannot login with Safari" bug,priority-high

# With milestone and assignee
/create-gh-issue "Add dark mode" "" enhancement,ui v2.0 @me
```

### /read-gh-issue

**Arguments:**

- `[issue-number]` - The issue number to read (required)
- `--comments` - Include issue comments in the output

**Examples:**

```bash
# Read issue
/read-gh-issue 123

# Read issue with comments
/read-gh-issue 456 --comments
```
