---
name: read-gh-issue
description: Read a GitHub issue by number
argument-hint: "[issue-number] [--comments]"
---

# Read GitHub Issue

## Overview

Retrieve the complete content of a GitHub issue including title, body, labels, and metadata for use in SDLC workflows. Optionally includes issue comments.

## Arguments

### Definitions

- **`[issue-number]`** (required): The issue number to read (e.g., `123`).
- **`[--comments]`** (optional): Include issue comments in the output.

### Values

$ARGUMENTS

## Core Principles

- Verify `gh` CLI is available and authenticated before attempting to read
- Return structured information that can be used by other commands
- Include all relevant metadata (labels, milestone, assignees, state)
- Handle non-existent issues gracefully with clear error messages

## Instructions

1. Verify the `gh` CLI is available by running `gh --version`

2. Parse the issue number from the command input

3. Execute the gh command to view the issue:

   ```
   gh issue view <issue-number> --json title,body,labels,milestone,assignees,state,comments,url
   ```

4. Parse the JSON response and format the output

5. If `--comments` flag is provided, include all issue comments

6. If the issue doesn't exist, report a clear error message

## Output Guidance

Return a JSON object with the following structure:

On success:

```json
{
  "success": true,
  "issue_number": 123,
  "title": "Add authentication feature",
  "state": "open",
  "url": "https://github.com/owner/repo/issues/123",
  "labels": ["enhancement", "priority-high"],
  "milestone": "v2.0",
  "assignees": ["username1", "username2"],
  "body": "Full issue description text...",
  "comments": [
    {
      "author": "username",
      "created_at": "2024-01-15T10:30:00Z",
      "body": "Comment text..."
    }
  ],
  "message": "Issue retrieved successfully"
}
```

On error:

```json
{
  "success": false,
  "issue_number": 999,
  "error": "issue not found",
  "message": "Failed to retrieve issue"
}
```

## Templates

Format the structured summary for display:

```
## Issue #<number>: <title>

**State**: <open/closed>
**Labels**: <label1>, <label2>
**Milestone**: <milestone or N/A>
**Assignees**: <assignee1>, <assignee2> or Unassigned

### Description

<issue body>

### Comments (if requested)

**@username** (date):
<comment body>
```
