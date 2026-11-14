---
name: esp-analyze
description: Severity-ranked codebase analysis report for one issue type. Use to audit the codebase for bugs, technical debt, documentation drift, security vulnerabilities, or style inconsistencies.
argument-hint: "-t|--type <type> [context]"
---

# Analyze Codebase

## Overview

Analyze the codebase for one type of issue and save a markdown report: findings rated by severity, each with its file location and an actionable fix.

## Arguments

### Definitions

- **`-t|--type <type>`** (required): Analysis type to perform. Must be one of:
  - `bug` - Logic errors, runtime errors, and edge cases
  - `debt` - Technical debt, architecture, and performance issues
  - `doc` - Documentation accuracy and completeness
  - `security` - Vulnerabilities, unsafe patterns, and dependency issues
  - `style` - Code style, consistency, and best practices
- **`[context]`** (optional): Specific areas or concerns to focus on, or directories/files to analyze. When it names paths, only these paths are analyzed. Otherwise, the entire codebase is analyzed.

### Values

Arguments: $ARGUMENTS

## Additional Resources

Load the one reference that matches `--type`:

- For bug analysis, see [references/bug.md](references/bug.md)
- For debt analysis, see [references/debt.md](references/debt.md)
- For doc analysis, see [references/doc.md](references/doc.md)
- For security analysis, see [references/security.md](references/security.md)
- For style analysis, see [references/style.md](references/style.md)

## Core Principles

- Report only real, unfixed issues, each with its exact file and line
- A finding is real only after you checked that the project's patterns, framework conventions, an intentional design choice, or code elsewhere do not already handle or explain it
- Treat test-specific patterns and legitimate, handled edge cases as intended behavior
- When nothing is found, the report still exists, with zero counts

## Skill-Specific Guidelines

### Configuration

Read the `analyze` section once at the start:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get analyze
```

If the command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), continue with the defaults.

- `analyze.output_dir` (default `analysis`): directory, relative to the repository root, for saved reports

In the instructions below, `{output_dir}` is the resolved `analyze.output_dir`.

## Instructions

1. **Validate the type**
   - Read the type from `-t` or `--type` (`--type=<type>` works too)
   - If it is missing or not one of `bug`, `debt`, `doc`, `security`, `style`, stop and report:

     ```text
     Error: Invalid or missing --type. Must be one of: bug, debt, doc, security, style
     ```

   - Load the `analyze` configuration (see Configuration)

2. **Load the type reference**: read `references/<type>.md` (see Additional Resources).

3. **Determine scope**
   - If `[context]` names files or directories, analyze those; otherwise the entire codebase
   - Exclude test files, node_modules, build outputs, and vendor directories
   - For `doc`: find all documentation files (README, docs/, \*.md)

4. **Understand project context**
   - Check for linter configs (ESLint, Prettier, Ruff)
   - Read CLAUDE.md and AGENTS.md (if present) for project-specific guidelines
   - Read representative code to learn the conventions the findings are judged against

5. **Analyze for issues**: apply every analysis criterion of the type reference to every file in scope, and verify each candidate per the Core Principles before keeping it. Done when each criterion has been checked across the whole scope.

6. **Categorize findings**: rate each one with the severity guidelines of the type reference. Done when every kept finding has exactly one severity.

7. **Generate the report**: save it to `{output_dir}/{type}.md` with the report template of the type reference: the date in the header, findings grouped by severity, each with its location and fix. Done when every kept finding appears under its severity with every template field filled, and the summary counts match the findings.

8. **Present results**: the severity counts and the report path (see Output Guidance).

## Output Guidance

Save a detailed markdown report and present a user-friendly summary:

```text
{Type} analysis complete. Report saved to {output_dir}/{type}.md

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
