# ESP Skills

## Overview

A single plugin bundling every skill in this repository: standardized git workflows, GitHub PR maintenance, high-signal code review, interactive SDLC planning and analysis, lightweight helpers, markdown style enforcement, and skill authoring. Skills are human-in-the-loop by default: they infer what they can from context and ask clarifying questions only when needed. Skills marked **Beta** are usable but may change.

Every skill is invoked as `/esp-skills:<skill>`. Unqualified names (`/esp-commit`, `/esp-qna`) also work as long as no other installed plugin provides a skill with the same name.

- `/esp-skills:esp-branch feature add-oauth 123` - Create a branch with standardized naming
- `/esp-skills:esp-commit` - Commit changes with a structured message
- `/esp-skills:esp-pr` - Create a pull request with a contextual description
- `/esp-skills:esp-fix-pr 42` - Fix review comments and CI failures on a PR
- `/esp-skills:esp-code-review PR 123` - Review a pull request for high-signal issues
- `/esp-skills:esp-sdlc-plan feature Add OAuth login` - Plan a feature with milestones
- `/esp-skills:esp-analyze security` - Analyze the codebase for security issues
- `/esp-skills:esp-qna How does OAuth 2.0 work?` - Get a concise answer without code changes

## Skills

### Git

| Skill                    | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `/esp-skills:esp-branch` | Create branches with standardized naming conventions |
| `/esp-skills:esp-commit` | Commit changes with structured messages              |
| `/esp-skills:esp-pr`     | Create pull requests with contextual descriptions    |

### GitHub

| Skill                    | Description                                                                   |
| ------------------------ | ----------------------------------------------------------------------------- |
| `/esp-skills:esp-fix-pr` | **Beta** - Fix review comments and failing CI checks on a PR, then push fixes |

### Code Review

| Skill                         | Description                                                                |
| ----------------------------- | -------------------------------------------------------------------------- |
| `/esp-skills:esp-code-review` | Review a diff (local changes, a ref range, or a PR) for high-signal issues |

### SDLC

| Skill                       | Description                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| `/esp-skills:esp-sdlc-plan` | **Beta** - Create an implementation plan (feature, bug, or chore)    |
| `/esp-skills:esp-analyze`   | **Beta** - Analyze codebase for bugs, debt, docs, security, or style |

### Helpers

| Skill                        | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| `/esp-skills:esp-qna`        | Answer user questions with clear, concise responses |
| `/esp-skills:esp-rubberduck` | Rubber duck debugging and idea clarification        |

### Style

| Skill                      | Description                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `/esp-skills:esp-markdown` | **Beta** - Enforce markdown formatting conventions and non-auto-fixable lint rules |

### Skill Building

| Skill                          | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `/esp-skills:esp-create-skill` | **Beta** - Create a new Claude Code skill following best practices |

## Architecture

The SDLC skills (`esp-sdlc-plan`, `esp-analyze`) accept an optional `[context]` argument as the last parameter. Providing context upfront replaces questions that would otherwise be asked interactively.

```bash
# With context - minimal prompts
/esp-skills:esp-sdlc-plan bug "Login fails on Safari when using OAuth."

# Without context - interactive prompts
/esp-skills:esp-sdlc-plan bug
```

Plans are static documentation of work to be done:

- Plans are immutable during implementation (progress tracked via TodoWrite)
- No time estimates, deadlines, or scheduling information
- Content includes requirements, architecture, tasks, and validation criteria
- Implementation skills read plans as reference, not as mutable state

The `esp-code-review` skill produces plain markdown and performs no write-side effects. Routing the review (stdout, PR comment, file, CI annotation) is the caller's responsibility.

## Complete Examples

### /esp-skills:esp-branch

**Arguments:**

- `<branch-name>` - Short kebab-case description (required)
- `[category]` - Branch type: feature (default), fix, chore, doc, poc, refactor
- `[issue-id]` - GitHub issue number
- `[base]` - Base branch to create from (defaults to current location)

When only one argument is provided, it is treated as the branch-name with category defaulting to `feature`.

**Examples:**

```bash
# Simple branch (defaults to feature/add-dark-mode)
/esp-skills:esp-branch add-dark-mode

# With category
/esp-skills:esp-branch hotfix login-timeout

# With issue reference
/esp-skills:esp-branch feature add-oauth 123

# Branch from a specific base branch
/esp-skills:esp-branch feature add-oauth 123 develop
```

### /esp-skills:esp-commit

**Arguments:**

- `[message]` - Override commit title (auto-generated if not provided)

**Examples:**

```bash
# Auto-generate commit message from changes
/esp-skills:esp-commit

# With custom message
/esp-skills:esp-commit Fix login timeout on Safari
```

### /esp-skills:esp-pr

**Arguments:**

- `[base-branch]` - Target branch for the PR (defaults to main/master)
- `[--draft]` - Create the PR as a draft

**Examples:**

```bash
# Create PR to default branch
/esp-skills:esp-pr

# Create PR to specific branch
/esp-skills:esp-pr develop

# Create draft PR
/esp-skills:esp-pr --draft
```

### /esp-skills:esp-fix-pr

**Arguments:**

- `<pr-number>` (required) - The pull request number to fix

**Examples:**

```bash
# Fix all review comments and CI failures on PR 42
/esp-skills:esp-fix-pr 42
```

### /esp-skills:esp-code-review

**Arguments:**

- `[target]` - What to review. Omit for local changes. Accepts `staged`, `unstaged`, a ref (`main`, `origin/main`), a range (`main..HEAD`), or a PR reference (`PR 123`, `#123`).

**Examples:**

```bash
# Review all local changes (staged + unstaged, or branch vs default if clean)
/esp-skills:esp-code-review

# Review only staged changes, e.g. as a pre-commit sanity check
/esp-skills:esp-code-review staged

# Review the current branch against main
/esp-skills:esp-code-review main

# Review an explicit range
/esp-skills:esp-code-review origin/main..HEAD

# Review a GitHub pull request (requires gh to be authenticated)
/esp-skills:esp-code-review PR 123
/esp-skills:esp-code-review #123
```

### /esp-skills:esp-sdlc-plan

**Arguments:**

- `[--git]` - Commit plan file after creation
- `[type]` - Plan type: `feature`, `bug`, `chore`, or `auto` (default: `auto`)
- `[explore-count]` - Override default explore agent count
- `[path]` - Directory where the plan file is saved (default: `specs`)
- `[context]` - Task description

**Examples:**

```bash
# Plan a feature with context
/esp-skills:esp-sdlc-plan feature Add user authentication with OAuth for Google and GitHub

# Plan a bug fix
/esp-skills:esp-sdlc-plan bug Login fails on Safari when using OAuth

# Plan a chore
/esp-skills:esp-sdlc-plan chore Update all npm dependencies to latest versions

# Auto-detect type from context
/esp-skills:esp-sdlc-plan Fix the login timeout issue

# Plan with exploration and commit
/esp-skills:esp-sdlc-plan feature 5 --git Implement real-time notifications
```

### /esp-skills:esp-analyze

**Arguments:**

- `<type>` - Analysis type: `bug`, `debt`, `doc`, `security`, or `style` (required)
- `[context]` - Focus areas or directories to analyze

**Examples:**

```bash
# Bug analysis
/esp-skills:esp-analyze bug
/esp-skills:esp-analyze bug Focus on error handling in API routes
/esp-skills:esp-analyze bug src/api/ src/services/

# Documentation analysis
/esp-skills:esp-analyze doc Check API documentation accuracy

# Technical debt analysis
/esp-skills:esp-analyze debt Focus on database access patterns

# Style analysis
/esp-skills:esp-analyze style Check naming conventions in React components

# Security analysis
/esp-skills:esp-analyze security Focus on authentication and session management
```

### /esp-skills:esp-qna

**Arguments:**

- `<question>` - The question to answer

**Examples:**

```bash
# Ask a technical question
/esp-skills:esp-qna What is the difference between let and const in JavaScript?

# Ask for best practices
/esp-skills:esp-qna What are the best practices for error handling in Node.js?
```

### /esp-skills:esp-rubberduck

**Arguments:**

- `<context>` - The idea, plan, code snippet, or issue to discuss

**Examples:**

```bash
# Clarify a plan
/esp-skills:esp-rubberduck I'm planning to extract the token validation logic into a separate middleware.

# Debug an issue
/esp-skills:esp-rubberduck My component is not re-rendering when the prop changes.

# Discuss a design decision
/esp-skills:esp-rubberduck Should we use Redux or Context API for state management in this project?
```

### /esp-skills:esp-markdown

This skill takes no arguments. It is automatically invoked when creating, editing, or reviewing markdown files.

```bash
# Review a markdown file for style issues
/esp-skills:esp-markdown
```

### /esp-skills:esp-create-skill

**Arguments:**

- `<skill-name>` - Name for the new skill in kebab-case (e.g., `review-code`, `analyze-deps`)
- `[context]` - Additional context about what the skill should do

**Examples:**

```bash
# Create a skill with just a name
/esp-skills:esp-create-skill deploy-staging

# Create a skill with context
/esp-skills:esp-create-skill review-pr A skill that reviews pull requests for code quality and security issues
```
