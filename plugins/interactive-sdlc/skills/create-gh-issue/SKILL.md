---
name: create-gh-issue
description: Create a GitHub issue with title, body, and labels
argument-hint: <title> [body] [labels] [milestone] [assignee]
---

# Create GitHub Issue

## Overview

Create a well-formed GitHub issue using the `gh` CLI tool, returning the issue URL for reference. Supports title, body, labels, milestone, and assignee options.

## Arguments

### Definitions

- **`<title>`** (required): The issue title.
- **`[body]`** (optional): The issue body/description.
- **`[labels]`** (optional): Comma-separated list of labels to apply.
- **`[milestone]`** (optional): Milestone to assign the issue to.
- **`[assignee]`** (optional): GitHub username to assign (use `@me` for self).

### Values

$ARGUMENTS

## Core Principles

- Verify `gh` CLI is available and authenticated before attempting creation
- Validate required parameters before executing
- Use proper escaping for special characters in title and body
- Return the created issue URL for use in workflows

## Instructions

1. Verify the `gh` CLI is available by running `gh --version`

2. Parse the title and optional parameters from the command input

3. Build the `gh issue create` command with provided parameters:

   ```
   gh issue create --title "<title>" [--body "<body>"] [--label "<labels>"] [--milestone "<milestone>"] [--assignee "<assignee>"]
   ```

4. Execute the command and capture the output

5. If successful, extract and return the issue URL from the output

6. If creation fails, report the error and suggest fixes (authentication, permissions, etc.)

## Output Guidance

Provide a brief confirmation message:

**On success:**

```
Issue created: https://github.com/owner/repo/issues/123
Title: Add authentication
Labels: enhancement, priority-high
```

**On failure:**

```
Failed to create issue: <error message from gh CLI>
Suggestion: Check that gh is authenticated with 'gh auth status'
```
