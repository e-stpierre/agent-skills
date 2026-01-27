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
- Return structured information that can be used by other skills
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

Display the issue information in a readable format.

**On success:** Use the template in the Templates section below.

**On error:**
```
Failed to retrieve issue #999: issue not found
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
