---
name: bump-version
description: >-
  Update library versions by analyzing changes since the last release. Supports npm packages (package.json + root CHANGELOG)
  and agent-skills repositories (per-plugin CHANGELOGs + marketplace.json). Automatically detects version component or accepts
  an explicit major/minor/patch argument.
argument-hint: "[version-component] [context]"
---

# Bump Version

## Overview

Analyze the diff between the current code and the latest released version, then update version numbers and CHANGELOGs accordingly. Supports two project types: npm packages (single package.json and root CHANGELOG) and agent-skills repositories (per-plugin CHANGELOGs with optional marketplace.json). Automatically detects the appropriate version component from the nature of changes, or accepts an explicit override.

## Arguments

### Definitions

- **`[version-component]`** (optional): The semantic version component to increment. Valid values: `major`, `minor`, `patch`. If not provided, automatically detect based on the nature of changes.
- **`[context]`** (optional): Additional context for the version bump. Common use cases:
  - A short mention or list of changes to include in the CHANGELOG (will be converted to proper CHANGELOG entries)
  - Full CHANGELOG entries to use as-is (must follow the bullet-point format defined in CHANGELOG Format)

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For npm package version updates, see [node-package.md](references/node-package.md)
- For agent-skills repository version updates, see [agent-skills.md](references/agent-skills.md)

## Core Principles

- Follow semantic versioning (MAJOR.MINOR.PATCH)
  - **MAJOR**: Breaking changes, removed features, incompatible API changes
  - **MINOR**: New features, new capabilities, added functionality
  - **PATCH**: Bug fixes, documentation updates, minor improvements
- Version increment rules:
  - MAJOR: increment first number, reset others to 0 (e.g., 1.2.3 -> 2.0.0)
  - MINOR: increment second number, reset patch to 0 (e.g., 1.2.3 -> 1.3.0)
  - PATCH: increment third number (e.g., 1.2.3 -> 1.2.4)
- Always update the CHANGELOG before bumping version numbers
- Keep CHANGELOG entries concise using bullet points
- Place new version entries at the top, below the header
- When `version-component` is provided, use it directly instead of auto-detecting
- **Pre-release versions (0.x.y)**: When the current major version is 0, treat the version as pre-release:
  - Breaking changes increment MINOR (not MAJOR), e.g., 0.3.2 -> 0.4.0
  - New features increment PATCH, e.g., 0.3.2 -> 0.3.3
  - Only bump to 1.0.0 if the user explicitly requests a major version bump

## Skill-Specific Guidelines

### Project Type Detection

Detect the project type to determine which reference to follow:

- **npm package**: A `package.json` exists at the repository root with a `version` field
- **agent-skills repository**: A `plugins/` directory exists containing plugin subdirectories with `CHANGELOG.md` files

If both indicators are present, prefer the agent-skills flow when operating inside an agent-skills repository structure.

### Auto-Detection of Version Component

When `version-component` is not provided, analyze the diff to determine the appropriate increment:

- Look for breaking changes (API removals, signature changes, incompatible behavior) -> MAJOR
- Look for new features (new files, new commands, new exports, new capabilities) -> MINOR
- Everything else (fixes, docs, refactoring, minor tweaks) -> PATCH

### CHANGELOG Format

Use a flat bullet-point format for CHANGELOG entries. No brackets around the version, no date, no sub-headers:

```markdown
## X.Y.Z

- Added new feature or capability
- Updated existing behavior or functionality
- Fixed bug description
- Removed deprecated feature
- **Breaking:** Description of breaking change
```

**Rules:**

- Version header: `## X.Y.Z` (no brackets, no date)
- No `###` sub-headers (no `### Added`, `### Fixed`, etc.)
- Each bullet starts with an action word (Added, Updated, Fixed, Removed, etc.) to describe the type of change
- Prefix breaking changes with `**Breaking:**`
- Every entry must describe a specific change. Avoid generic or vague entries like "Fixed 5 bugs" or "Various improvements". Either list each noteworthy change individually, or omit it entirely
- If the CHANGELOG file does not exist, create it with this structure:

```markdown
# Changelog

## X.Y.Z

- First change entry
```

### Incremental Updates Within a Branch

If a version was already bumped in the current branch (i.e., the CHANGELOG already has an entry that was added in this branch), do not create a new version entry. Instead, append new change bullets to the existing entry for that version.

If the newly requested version component differs from the one used previously in the branch (e.g., user now requests `major` but the branch previously bumped `minor`), use the new requested component, update the version number accordingly, and highlight this change in the completion message.

This same rule applies to global version files (`package.json`, `marketplace.json`): if they were already bumped in the current branch, do not bump them again unless the version component changes.

## Instructions

1. **Detect project type**

   Check if the project is an npm package or an agent-skills repository:
   - Look for `package.json` at the root with a `version` field
   - Look for `plugins/` directory with plugin subdirectories containing `CHANGELOG.md` files
   - Follow the appropriate reference file based on the detected type

2. **Determine the latest released version**

   - **npm package**: Read the `version` field from `package.json`
   - **agent-skills**: Read the latest version from each plugin's `CHANGELOG.md`

3. **Get the diff since the latest release**

   Compare the current branch against the main branch (`git diff main...HEAD`) to identify all changes. For project-specific details:
   - **npm package**: Follow instructions in [node-package.md](references/node-package.md)
   - **agent-skills**: Follow instructions in [agent-skills.md](references/agent-skills.md)

4. **Determine version component**

   If `version-component` argument was provided, use it directly. Otherwise, analyze the diff to auto-detect the appropriate component (see Auto-Detection guidelines above).

5. **Update CHANGELOG(s)**

   Check if a version entry was already added in the current branch. If so, append new changes to that entry (and adjust the version number if the requested component differs). Otherwise, add a new version entry at the top of the relevant CHANGELOG file(s) with categorized changes.

   If `context` was provided, use it to populate the CHANGELOG entries:
   - If the context contains properly formatted CHANGELOG bullets (lines starting with `- `), use them as-is
   - If the context is a short description or list, convert it into proper CHANGELOG entries following the format rules

6. **Bump version number(s)**

   Update all version declarations to the new version:
   - **npm package**: Update `version` in `package.json`
   - **agent-skills**: Update `marketplace.json` if it exists, and any other version files

7. **Report changes**

   Summarize what was updated.

## Output Guidance

Report the version bump results:

**On success:**

```text
## Version Bump Summary

Project type: <npm-package | agent-skills>

### Changes Analyzed
- <brief summary of changes detected>
- Version component: <major|minor|patch> (<auto-detected|user-specified>)

### Updates Applied
| File | Old Version | New Version |
|------|-------------|-------------|
| <file> | X.Y.Z | A.B.C |

### CHANGELOG Updated
- <file>: Added entry for vA.B.C
```

**On error:**

```text
Failed to bump version: <error description>
```
