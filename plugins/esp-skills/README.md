# ESP Skills

## Overview

A single plugin bundling every skill in this repository: standardized git workflows, GitHub PR maintenance, high-signal code review, interactive SDLC planning and analysis, lightweight helpers, task tracking, markdown style enforcement, skill authoring, and version management. Skills are human-in-the-loop by default: they infer what they can from context and ask clarifying questions only when needed. Skills marked **Beta** are usable but may change.

Every skill is invoked as `/esp-skills:<skill>`. Unqualified names (`/git-commit`, `/qna`) also work as long as no other installed plugin provides a skill with the same name.

- `/esp-skills:git-branch feature add-oauth 123` - Create a branch with standardized naming
- `/esp-skills:git-commit` - Commit changes with a structured message
- `/esp-skills:git-pr` - Create a pull request with a contextual description
- `/esp-skills:fix-pr 42` - Fix review comments and CI failures on a PR
- `/esp-skills:code-review PR 123` - Review a pull request for high-signal issues
- `/esp-skills:sdlc-plan feature Add OAuth login` - Plan a feature with milestones
- `/esp-skills:analyze security` - Analyze the codebase for security issues
- `/esp-skills:qna How does OAuth 2.0 work?` - Get a concise answer without code changes
- `/esp-skills:add-task Fix error handling in auth module` - Track a task in `tasks.md`
- `/esp-skills:bump-version` - Bump versions and update CHANGELOGs

## Skills

### Git

| Skill                    | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `/esp-skills:git-branch` | Create branches with standardized naming conventions |
| `/esp-skills:git-commit` | Commit changes with structured messages              |
| `/esp-skills:git-pr`     | Create pull requests with contextual descriptions    |

### GitHub

| Skill                | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| `/esp-skills:fix-pr` | **Beta** - Fix review comments and failing CI checks on a PR, then push fixes |

### Code Review

| Skill                     | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `/esp-skills:code-review` | Review a diff (local changes, a ref range, or a PR) for high-signal issues |

### SDLC

| Skill                   | Description                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| `/esp-skills:sdlc-plan` | **Beta** - Create an implementation plan (feature, bug, or chore)    |
| `/esp-skills:analyze`   | **Beta** - Analyze codebase for bugs, debt, docs, security, or style |

### Helpers

| Skill                    | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `/esp-skills:qna`        | Answer user questions with clear, concise responses |
| `/esp-skills:rubberduck` | Rubber duck debugging and idea clarification        |

### Tasks

| Skill                  | Description                                   |
| ---------------------- | --------------------------------------------- |
| `/esp-skills:add-task` | Add a new task to the tasks tracking document |

### Style

| Skill                  | Description                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `/esp-skills:markdown` | **Beta** - Enforce markdown formatting conventions and non-auto-fixable lint rules |

### Skill Building

| Skill                      | Description                                                        |
| -------------------------- | ------------------------------------------------------------------ |
| `/esp-skills:create-skill` | **Beta** - Create a new Claude Code skill following best practices |

### Versioning

| Skill                      | Description                                            |
| -------------------------- | ------------------------------------------------------ |
| `/esp-skills:bump-version` | Update version numbers and CHANGELOGs based on changes |

## Architecture

The SDLC skills (`sdlc-plan`, `analyze`) accept an optional `[context]` argument as the last parameter. Providing context upfront replaces questions that would otherwise be asked interactively.

```bash
# With context - minimal prompts
/esp-skills:sdlc-plan bug "Login fails on Safari when using OAuth."

# Without context - interactive prompts
/esp-skills:sdlc-plan bug
```

Plans are static documentation of work to be done:

- Plans are immutable during implementation (progress tracked via TodoWrite)
- No time estimates, deadlines, or scheduling information
- Content includes requirements, architecture, tasks, and validation criteria
- Implementation skills read plans as reference, not as mutable state

The `code-review` skill produces plain markdown and performs no write-side effects. Routing the review (stdout, PR comment, file, CI annotation) is the caller's responsibility.

## Complete Examples

### /esp-skills:git-branch

**Arguments:**

- `<branch-name>` - Short kebab-case description (required)
- `[category]` - Branch type: feature (default), fix, chore, doc, poc, refactor
- `[issue-id]` - GitHub issue number
- `[base]` - Base branch to create from (defaults to current location)

When only one argument is provided, it is treated as the branch-name with category defaulting to `feature`.

**Examples:**

```bash
# Simple branch (defaults to feature/add-dark-mode)
/esp-skills:git-branch add-dark-mode

# With category
/esp-skills:git-branch hotfix login-timeout

# With issue reference
/esp-skills:git-branch feature add-oauth 123

# Branch from a specific base branch
/esp-skills:git-branch feature add-oauth 123 develop
```

### /esp-skills:git-commit

**Arguments:**

- `[message]` - Override commit title (auto-generated if not provided)

**Examples:**

```bash
# Auto-generate commit message from changes
/esp-skills:git-commit

# With custom message
/esp-skills:git-commit Fix login timeout on Safari
```

### /esp-skills:git-pr

**Arguments:**

- `[base-branch]` - Target branch for the PR (defaults to main/master)
- `[--draft]` - Create the PR as a draft

**Examples:**

```bash
# Create PR to default branch
/esp-skills:git-pr

# Create PR to specific branch
/esp-skills:git-pr develop

# Create draft PR
/esp-skills:git-pr --draft
```

### /esp-skills:fix-pr

**Arguments:**

- `<pr-number>` (required) - The pull request number to fix

**Examples:**

```bash
# Fix all review comments and CI failures on PR 42
/esp-skills:fix-pr 42
```

### /esp-skills:code-review

**Arguments:**

- `[target]` - What to review. Omit for local changes. Accepts `staged`, `unstaged`, a ref (`main`, `origin/main`), a range (`main..HEAD`), or a PR reference (`PR 123`, `#123`).

**Examples:**

```bash
# Review all local changes (staged + unstaged, or branch vs default if clean)
/esp-skills:code-review

# Review only staged changes, e.g. as a pre-commit sanity check
/esp-skills:code-review staged

# Review the current branch against main
/esp-skills:code-review main

# Review an explicit range
/esp-skills:code-review origin/main..HEAD

# Review a GitHub pull request (requires gh to be authenticated)
/esp-skills:code-review PR 123
/esp-skills:code-review #123
```

### /esp-skills:sdlc-plan

**Arguments:**

- `[--git]` - Commit plan file after creation
- `[type]` - Plan type: `feature`, `bug`, `chore`, or `auto` (default: `auto`)
- `[explore-count]` - Override default explore agent count
- `[path]` - Directory where the plan file is saved (default: `specs`)
- `[context]` - Task description

**Examples:**

```bash
# Plan a feature with context
/esp-skills:sdlc-plan feature Add user authentication with OAuth for Google and GitHub

# Plan a bug fix
/esp-skills:sdlc-plan bug Login fails on Safari when using OAuth

# Plan a chore
/esp-skills:sdlc-plan chore Update all npm dependencies to latest versions

# Auto-detect type from context
/esp-skills:sdlc-plan Fix the login timeout issue

# Plan with exploration and commit
/esp-skills:sdlc-plan feature 5 --git Implement real-time notifications
```

### /esp-skills:analyze

**Arguments:**

- `<type>` - Analysis type: `bug`, `debt`, `doc`, `security`, or `style` (required)
- `[context]` - Focus areas or directories to analyze

**Examples:**

```bash
# Bug analysis
/esp-skills:analyze bug
/esp-skills:analyze bug Focus on error handling in API routes
/esp-skills:analyze bug src/api/ src/services/

# Documentation analysis
/esp-skills:analyze doc Check API documentation accuracy

# Technical debt analysis
/esp-skills:analyze debt Focus on database access patterns

# Style analysis
/esp-skills:analyze style Check naming conventions in React components

# Security analysis
/esp-skills:analyze security Focus on authentication and session management
```

### /esp-skills:qna

**Arguments:**

- `<question>` - The question to answer

**Examples:**

```bash
# Ask a technical question
/esp-skills:qna What is the difference between let and const in JavaScript?

# Ask for best practices
/esp-skills:qna What are the best practices for error handling in Node.js?
```

### /esp-skills:rubberduck

**Arguments:**

- `<context>` - The idea, plan, code snippet, or issue to discuss

**Examples:**

```bash
# Clarify a plan
/esp-skills:rubberduck I'm planning to extract the token validation logic into a separate middleware.

# Debug an issue
/esp-skills:rubberduck My component is not re-rendering when the prop changes.

# Discuss a design decision
/esp-skills:rubberduck Should we use Redux or Context API for state management in this project?
```

### /esp-skills:add-task

**Arguments:**

- `[--explore]` - Analyze codebase for additional technical context
- `[path]` - Where to store the task. Accepts a directory or full `.md` path. Defaults to `tasks.md` at repository root
- `<context>` - Description of the task (required)

**Examples:**

```bash
# Add a general task
/esp-skills:add-task Fix error handling in auth module

# Add a task with codebase exploration
/esp-skills:add-task --explore Improve database query performance

# Add a task to a specific file
/esp-skills:add-task docs/backlog.md Add API rate limiting documentation

# Add a task to a specific directory (creates tasks.md in that directory)
/esp-skills:add-task --explore src/api/ Refactor authentication middleware

# Add a security task (auto-prefixed SEC-XXX)
/esp-skills:add-task Review input validation for API endpoints
```

### /esp-skills:markdown

This skill takes no arguments. It is automatically invoked when creating, editing, or reviewing markdown files.

```bash
# Review a markdown file for style issues
/esp-skills:markdown
```

### /esp-skills:create-skill

**Arguments:**

- `<skill-name>` - Name for the new skill in kebab-case (e.g., `review-code`, `analyze-deps`)
- `[context]` - Additional context about what the skill should do

**Examples:**

```bash
# Create a skill with just a name
/esp-skills:create-skill deploy-staging

# Create a skill with context
/esp-skills:create-skill review-pr A skill that reviews pull requests for code quality and security issues
```

### /esp-skills:bump-version

Supports npm packages (single root CHANGELOG) and plugin marketplace repositories (per-plugin CHANGELOGs and `marketplace.json`).

**Arguments:**

- `[version-component]` - Version component to increment: `major`, `minor`, or `patch` (auto-detected if omitted)

**Examples:**

```bash
# Auto-detect version component from changes
/esp-skills:bump-version

# Explicitly bump patch version
/esp-skills:bump-version patch

# Explicitly bump minor version
/esp-skills:bump-version minor

# Explicitly bump major version for breaking changes
/esp-skills:bump-version major
```
