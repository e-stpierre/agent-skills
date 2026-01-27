# Interactive SDLC Plugin

Human-in-the-loop plugin for guided development within Claude Code sessions. Provides interactive planning, implementation, validation, and analysis workflows with smart context inference. All skills support optional context arguments to reduce prompts while maintaining the ability to ask clarifying questions.

## Overview

The Interactive SDLC plugin provides guided workflows for planning, implementing, and validating development tasks. Skills ask clarifying questions when needed and support context arguments for automation.

- `/sdlc-plan feature Add OAuth login` - Plan a feature with milestones
- `/build specs/feature-auth.md --git` - Implement a plan with auto-commits
- `/sdlc-review --plan specs/feature-auth.md` - Review implementation
- `/one-shot --git Fix login timeout` - Quick task without saved plan

## Skills

Skills are organized into logical categories. All paths are relative to `plugins/interactive-sdlc/skills/`.

### Setup

| Skill         | Description                               |
| ------------- | ----------------------------------------- |
| `/configure`  | Set up plugin configuration interactively |

### Planning

| Skill        | Description                                            |
| ------------ | ------------------------------------------------------ |
| `/sdlc-plan` | Create an implementation plan (feature, bug, or chore) |

### Development

| Skill          | Description                                                           |
| -------------- | --------------------------------------------------------------------- |
| `/build`       | Implement a plan file with checkpoint support                         |
| `/sdlc-review` | Comprehensive validation (tests, code review, build, plan compliance) |
| `/document`    | Generate or update documentation with mermaid diagrams                |

### Workflows

| Skill                  | Description                               |
| ---------------------- | ----------------------------------------- |
| `/one-shot`            | Quick task without saved plan file        |
| `/plan-build-validate` | Full workflow from planning to validation |

### Analysis

| Skill      | Description                                               |
| ---------- | --------------------------------------------------------- |
| `/analyze` | Analyze codebase for bugs, debt, docs, security, or style |

### Git

| Skill         | Description                                          |
| ------------- | ---------------------------------------------------- |
| `/git-branch` | Create branches with standardized naming conventions |
| `/git-commit` | Commit changes with structured messages              |
| `/git-pr`     | Create pull requests with contextual descriptions    |

### GitHub

| Skill              | Description                                       |
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

### /configure

**Arguments:** None

**Examples:**

```bash
# Run interactive configuration
/configure
```

### /sdlc-plan

**Arguments:**

- `[type]` - Plan type: `feature`, `bug`, `chore`, or `auto` (default: `auto`)
- `--explore N` - Override default explore agent count
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
/sdlc-plan feature --explore 5 --git Implement real-time notifications
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

### /sdlc-review

**Arguments:**

- `--plan [plan-file]` - Plan file to verify compliance
- `--skip-tests` - Skip test execution
- `--skip-build` - Skip build verification
- `--skip-review` - Skip code review
- `--autofix [levels]` - Auto-fix issues (e.g., "critical,major")

**Examples:**

```bash
# Full validation
/sdlc-review --plan specs/feature-auth.md

# Skip tests, auto-fix critical
/sdlc-review --skip-tests --autofix critical

# Quick validation
/sdlc-review --skip-tests --skip-build
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
/analyze doc docs/api.md README.md

# Technical debt analysis
/analyze debt
/analyze debt Focus on database access patterns
/analyze debt src/legacy/

# Style analysis
/analyze style
/analyze style Check naming conventions in React components
/analyze style src/components/

# Security analysis
/analyze security
/analyze security Focus on authentication and session management
/analyze security src/api/ src/auth/
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
