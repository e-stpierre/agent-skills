# Interactive SDLC Plugin

Human-in-the-loop plugin for guided development within Claude Code sessions. Provides interactive planning, implementation, validation, and analysis workflows with smart context inference. All commands support optional context arguments to reduce prompts while maintaining the ability to ask clarifying questions.

## Overview

The Interactive SDLC plugin provides guided workflows for planning, implementing, and validating development tasks. Commands ask clarifying questions when needed and support context arguments for automation.

- `/plan-feature Add OAuth login` - Plan a feature with milestones
- `/build specs/feature-auth.md --git` - Implement a plan with auto-commits
- `/validate --plan specs/feature-auth.md` - Validate implementation
- `/one-shot --git Fix login timeout` - Quick task without saved plan

## Commands

Commands are organized into logical categories. All paths are relative to the project root.

### Setup

| Command                       | Description                               |
| ----------------------------- | ----------------------------------------- |
| `/configure-interactive-sdlc` | Set up plugin configuration interactively |

### Planning (`commands/plan/`)

| Command         | Description                             |
| --------------- | --------------------------------------- |
| `/plan-chore`   | Plan a maintenance task                 |
| `/plan-bug`     | Plan a bug fix with root cause analysis |
| `/plan-feature` | Plan a feature with milestones          |

### Development (`commands/dev/`)

| Command     | Description                                                           |
| ----------- | --------------------------------------------------------------------- |
| `/build`    | Implement a plan file with checkpoint support                         |
| `/validate` | Comprehensive validation (tests, code review, build, plan compliance) |
| `/document` | Generate or update documentation with mermaid diagrams                |

### Workflows (`commands/workflows/`)

| Command                | Description                               |
| ---------------------- | ----------------------------------------- |
| `/one-shot`            | Quick task without saved plan file        |
| `/plan-build-validate` | Full workflow from planning to validation |

### Analysis (`commands/analyze/`)

| Command             | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `/analyze-bug`      | Analyze codebase for bugs and logic errors            |
| `/analyze-doc`      | Analyze documentation quality and accuracy            |
| `/analyze-debt`     | Identify technical debt and refactoring opportunities |
| `/analyze-style`    | Check code style, consistency, and best practices     |
| `/analyze-security` | Scan for security vulnerabilities and unsafe patterns |

### Git (`commands/git/`)

| Command       | Description                                          |
| ------------- | ---------------------------------------------------- |
| `/git-branch` | Create branches with standardized naming conventions |
| `/git-commit` | Commit changes with structured messages              |
| `/git-pr`     | Create pull requests with contextual descriptions    |

### GitHub (`commands/github/`)

| Command            | Description                                       |
| ------------------ | ------------------------------------------------- |
| `/create-gh-issue` | Create GitHub issues with title, body, and labels |
| `/read-gh-issue`   | Read GitHub issue content by number               |

## Arguments Reference

### Common Arguments

- `--git` - Auto-commit changes at logical checkpoints
- `--explore N` - Override default explore agent count for codebase analysis
- `[context]` - Optional freeform context as the last parameter

### Build-Specific Arguments

- `[plan-file]` - Required path to plan file (relative to project root)
- `--checkpoint "[text]"` - Resume from specific task/milestone

### Validate-Specific Arguments

- `--plan [plan-file]` - Plan file to verify compliance against
- `--skip-tests` - Skip test execution
- `--skip-build` - Skip build verification
- `--skip-review` - Skip code review
- `--autofix critical,major` - Auto-fix issues of specified severity levels

### Workflow-Specific Arguments

- `--pr` - Create draft PR when validation passes (plan-build-validate only)
- `--validate` - Run validation after implementation (one-shot only)

## Context Argument

All commands support an optional `[context]` argument as the last parameter. This allows you to provide upfront information that would otherwise require interactive questions.

**Benefits:**

- Faster workflow by providing all information upfront
- Better for automation and scripting
- Reduced friction with fewer interactive prompts
- Flexibility to choose between interactive or context mode

**Example:**

```bash
# With context - minimal prompts
/plan-bug --explore 3 Login fails on Safari when using OAuth.
Users click login button, get redirected to OAuth provider,
but after successful auth they are redirected to a blank page
instead of the dashboard.

# Without context - interactive prompts
/plan-bug --explore 3
```

## Plan File Principles

Plans are static documentation of work to be done:

- Plans are immutable during implementation (progress tracked via TodoWrite)
- No time estimates, deadlines, or scheduling information
- Content includes requirements, architecture, tasks, and validation criteria
- Implementation commands read plans as reference, not as mutable state

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

### /configure-interactive-sdlc

**Arguments:** None

**Examples:**

```bash
# Run interactive configuration
/configure-interactive-sdlc
```

### /plan-chore

**Arguments:**

- `--explore N` - Override default explore agent count (default: 2)
- `--git` - Commit plan file after creation
- `[context]` - Chore description

**Examples:**

```bash
# Plan with context
/plan-chore Update all npm dependencies to latest versions

# Plan with exploration
/plan-chore --explore 3 Refactor database connection pooling

# Plan and commit
/plan-chore --git Clean up unused imports across codebase
```

### /plan-bug

**Arguments:**

- `--explore N` - Override default explore agent count (default: 2)
- `--git` - Commit plan file after creation
- `[context]` - Bug description

**Examples:**

```bash
# Plan with context
/plan-bug Login fails on Safari when using OAuth

# Plan with exploration
/plan-bug --explore 3 Memory leak in WebSocket handler

# Plan and commit
/plan-bug --git Race condition in checkout flow
```

### /plan-feature

**Arguments:**

- `--explore N` - Override default explore agent count (default: 3)
- `--git` - Commit plan file after creation
- `[context]` - Feature description

**Examples:**

```bash
# Plan with context
/plan-feature Add user authentication with OAuth for Google and GitHub

# Plan with more exploration
/plan-feature --explore 5 Implement real-time notifications

# Plan and commit
/plan-feature --git --explore 4 Add dark mode toggle
```

### /build

**Arguments:**

- `[plan-file]` - Required path to plan file
- `--git` - Auto-commit at milestones
- `--checkpoint "[text]"` - Resume from specific task/milestone
- `[context]` - Implementation guidance

**Examples:**

```bash
# Basic build
/build specs/feature-auth.md

# Build with auto-commit
/build specs/feature-auth.md --git

# Resume from checkpoint
/build specs/feature-auth.md --checkpoint "Milestone 2" --git
```

### /validate

**Arguments:**

- `--plan [plan-file]` - Plan file to verify compliance
- `--skip-tests` - Skip test execution
- `--skip-build` - Skip build verification
- `--skip-review` - Skip code review
- `--autofix [levels]` - Auto-fix issues (e.g., "critical,major")

**Examples:**

```bash
# Full validation
/validate --plan specs/feature-auth.md

# Skip tests, auto-fix critical
/validate --skip-tests --autofix critical

# Quick validation
/validate --skip-tests --skip-build
```

### /document

**Arguments:**

- `--output [path]` - Specify output file path
- `[context]` - Description of what to document

**Examples:**

```bash
# Document API endpoints
/document --output docs/api.md Document the REST API endpoints

# Document architecture
/document --output docs/architecture.md Document the system architecture

# Auto-detect output location
/document Document the authentication flow
```

### /one-shot

**Arguments:**

- `--git` - Auto-commit when done
- `--validate` - Run validation after implementation
- `--explore N` - Override explore agent count (default: 0)
- `[context]` - Task description

**Examples:**

```bash
# Quick fix
/one-shot Fix typo in README

# Fix with commit and validation
/one-shot --git --validate Fix login timeout on Safari

# With exploration
/one-shot --explore 2 --git Refactor auth middleware
```

### /plan-build-validate

**Arguments:**

- `--git` - Auto-commit throughout workflow
- `--pr` - Create draft PR when validation passes
- `--explore N` - Override explore agent count for planning phase
- `[context]` - Task description

**Examples:**

```bash
# Full workflow with PR
/plan-build-validate --git --pr Add dark mode toggle

# Without PR creation
/plan-build-validate --git Fix authentication timeout issue

# With extra exploration
/plan-build-validate --explore 5 --git --pr Implement user notifications
```

### /analyze-bug

**Arguments:**

- `[context]` - Focus areas or directories to analyze

**Examples:**

```bash
# Full bug analysis
/analyze-bug

# Focused analysis
/analyze-bug Focus on error handling in API routes

# Directory-specific
/analyze-bug src/api/ src/services/
```

### /analyze-doc

**Arguments:**

- `[context]` - Specific documentation files or areas to focus on

**Examples:**

```bash
# Full documentation analysis
/analyze-doc

# Focused analysis
/analyze-doc Check API documentation accuracy

# Specific files
/analyze-doc docs/api.md README.md
```

### /analyze-debt

**Arguments:**

- `[context]` - Specific areas or concerns to focus on

**Examples:**

```bash
# Full debt analysis
/analyze-debt

# Focused analysis
/analyze-debt Focus on database access patterns

# Module-specific
/analyze-debt src/legacy/
```

### /analyze-style

**Arguments:**

- `[context]` - Specific areas or files to focus on

**Examples:**

```bash
# Full style analysis
/analyze-style

# Focused analysis
/analyze-style Check naming conventions in React components

# Directory-specific
/analyze-style src/components/
```

### /analyze-security

**Arguments:**

- `[context]` - Focus areas or directories to analyze

**Examples:**

```bash
# Full security analysis
/analyze-security

# Focused analysis
/analyze-security Focus on authentication and session management

# Directory-specific
/analyze-security src/api/ src/auth/
```

### /git-branch

**Arguments:**

- `[category]` - Branch type: feature (default), fix, chore, doc, poc, refactor
- `[branch-name]` - Short kebab-case description (required)
- `[issue-id]` - GitHub issue number

When only one argument is provided, it is treated as the branch-name with category defaulting to `feature`.

**Examples:**

```bash
# Simple branch (defaults to feature/add-dark-mode)
/git-branch add-dark-mode

# With category
/git-branch hotfix login-timeout

# With issue reference
/git-branch feature add-oauth 123
```

### /git-commit

**Arguments:**

- `[message]` - Override commit title (auto-generated if not provided)

**Examples:**

```bash
# Auto-generate commit message from changes
/git-commit

# With custom message
/git-commit Fix login timeout on Safari
```

### /git-pr

**Arguments:**

- `[base-branch]` - Target branch for the PR (defaults to main/master)

**Examples:**

```bash
# Create PR to default branch
/git-pr

# Create PR to specific branch
/git-pr develop
```

### /create-gh-issue

**Arguments:**

- `"[title]"` - Issue title (required, use quotes if it contains spaces)
- `--body [body]` - Issue body/description
- `--labels [labels]` - Comma-separated list of labels
- `--milestone [milestone]` - Milestone to assign
- `--assignee [assignee]` - GitHub username (use `@me` for self)

**Examples:**

```bash
# Simple issue
/create-gh-issue "Fix login bug"

# With body and labels
/create-gh-issue "Fix login bug" --body "Users cannot login with Safari" --labels bug,priority-high

# With milestone and assignee
/create-gh-issue "Add dark mode" --labels enhancement,ui --milestone "v2.0" --assignee @me
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
