# Git

## Overview

Standardized git workflow skills for branch creation, structured commits, and pull request management. Provides consistent naming conventions, AI attribution, and GitHub CLI integration.

- `/git-branch add-dark-mode` - Create a branch with standardized naming
- `/git-commit` - Commit changes with a structured message and AI attribution
- `/git-pr` - Create a pull request with contextual title and description

## Skills

| Skill         | Description                                          |
| ------------- | ---------------------------------------------------- |
| `/git-branch` | Create branches with standardized naming conventions |
| `/git-commit` | Commit changes with structured messages              |
| `/git-pr`     | Create pull requests with contextual descriptions    |

## Complete Examples

### /git-branch

**Arguments:**

- `<branch-name>` - Short kebab-case description (required)
- `[category]` - Branch type: feature (default), fix, chore, doc, poc, refactor
- `[issue-id]` - GitHub issue number
- `[base]` - Base branch to create from (defaults to current location)

When only one argument is provided, it is treated as the branch-name with category defaulting to `feature`.

**Examples:**

```bash
# Simple branch (defaults to feature/add-dark-mode)
/git-branch add-dark-mode

# With category
/git-branch hotfix login-timeout

# With issue reference
/git-branch feature add-oauth 123

# Branch from a specific base branch
/git-branch feature add-oauth 123 develop
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
- `[--draft]` - Create the PR as a draft

**Examples:**

```bash
# Create PR to default branch
/git-pr

# Create PR to specific branch
/git-pr develop

# Create draft PR
/git-pr --draft
```
