---
name: analyze
description: Analyze codebase for bugs, debt, documentation, security, or style issues
argument-hint: <type> [context]
---

# Analyze Codebase

## Overview

Analyze codebase for issues across multiple domains: bugs, technical debt, documentation, security vulnerabilities, or style inconsistencies. Categorizes findings by severity with specific file locations and actionable fix suggestions. Returns structured JSON for workflow integration and generates a markdown report.

## Arguments

### Definitions

- **`<type>`** (required): Analysis type to perform. Must be one of:
  - `bug` - Logic errors, runtime errors, and edge cases
  - `debt` - Technical debt, architecture, and performance issues
  - `doc` - Documentation accuracy and completeness
  - `security` - Vulnerabilities, unsafe patterns, and dependency issues
  - `style` - Code style, consistency, and best practices
- **`[context]`** (optional): Specific areas or concerns to focus on, or directories/files to analyze. When provided, only these paths are analyzed. Otherwise, the entire codebase is analyzed.

### Values

Arguments: $ARGUMENTS

## Additional Resources

Load ONE of these based on the `<type>` argument:

- For bug analysis, see [references/bug.md](references/bug.md)
- For debt analysis, see [references/debt.md](references/debt.md)
- For doc analysis, see [references/doc.md](references/doc.md)
- For security analysis, see [references/security.md](references/security.md)
- For style analysis, see [references/style.md](references/style.md)

## Configuration

This skill reads configuration from `.claude/configs/interactive-sdlc.json`:

- **`analysisDirectory`**: Directory where analysis reports are saved. Defaults to `analysis`.

## Core Principles

- Only report REAL issues - quality over quantity
- Only report UNFIXED issues - if resolved, do not include it
- Be specific with exact file and line numbers
- Understand project patterns before flagging issues
- Consider framework conventions and intentional design choices
- Check if apparent issues are handled elsewhere before flagging
- Recognize test-specific patterns and legitimate edge cases
- If no issues found, return success with zero counts

## Instructions

1. **Validate Type Argument**
   - Check that `<type>` argument is provided
   - Verify it is one of: `bug`, `debt`, `doc`, `security`, `style`
   - If missing or invalid, stop execution and return error:

     ```json
     {
       "success": false,
       "error": "Invalid or missing type argument. Must be one of: bug, debt, doc, security, style"
     }
     ```

2. **Load Type-Specific Guidelines**
   Based on the `<type>` argument, load the corresponding reference file:
   - `bug` -> Read [references/bug.md](references/bug.md)
   - `debt` -> Read [references/debt.md](references/debt.md)
   - `doc` -> Read [references/doc.md](references/doc.md)
   - `security` -> Read [references/security.md](references/security.md)
   - `style` -> Read [references/style.md](references/style.md)

3. **Read Configuration**
   - Read `.claude/configs/interactive-sdlc.json` for `analysisDirectory` (default: `analysis`)

4. **Determine Scope**
   - If `[context]` specifies files/directories, focus on those
   - Otherwise, analyze the entire codebase
   - Exclude test files, node_modules, build outputs, and vendor directories
   - For `doc` type: find all documentation files (README, docs/, \*.md)

5. **Understand Project Context**
   - Check for linter configs (ESLint, Prettier, Ruff)
   - Read CLAUDE.md for project-specific guidelines
   - Analyze existing code patterns to understand conventions

6. **Analyze for Issues**
   - Apply type-specific analysis criteria from the loaded reference file
   - Verify each finding is a real issue, not a false positive
   - Check if apparent issues are handled elsewhere

7. **Categorize Findings**
   - Apply severity ratings as defined in the type-specific reference file
   - Use consistent severity levels across all types

8. **Generate Report**
   - Save to `{analysisDirectory}/{type}.md`
   - Include date in report header
   - Group findings by severity
   - Use the template from the type-specific reference file

9. **Present Results**
   - Display summary counts by severity
   - Inform user of report file location

## Output Guidance

Save a detailed markdown report and present a user-friendly summary:

```
{Type} analysis complete. Report saved to {analysisDirectory}/{type}.md

## Summary
- Critical: X issues
- High: Y issues
- Medium: Z issues
- Low: W issues

[If no issues found:]
No issues identified - codebase appears healthy.

[If issues found:]
Review the report and prioritize fixes by severity.
```
