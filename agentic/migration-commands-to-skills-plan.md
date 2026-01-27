# Migration Plan: Commands to Skills

This plan outlines the conversion of interactive-sdlc commands to the skills format.

## Progress Checklist

- [x] **Milestone 1: Foundation** - Prepare repository structure and update skill template
- [x] **Milestone 2: Convert Planning Skills** - configure, plan-bug, plan-chore, plan-feature
- [x] **Milestone 3: Convert Development Skills** - build, validate, document, one-shot, plan-build-validate
- [x] **Milestone 4: Convert Analysis Skills** - analyze-bug, analyze-debt, analyze-doc, analyze-security, analyze-style
- [x] **Milestone 5: Convert Git and GitHub Skills** - git-branch, git-commit, git-pr, create-gh-issue, read-gh-issue
- [x] **Milestone 6: Documentation and Cleanup** - Update README, CHANGELOG, cleanup, validate

## Overview

Convert 19 commands from `plugins/interactive-sdlc/commands/` to the skills format in `plugins/interactive-sdlc/skills/`, following the structure and conventions from the agentic-forge repository.

## Key Changes

### Structure Changes

| Aspect | Current (Commands) | Target (Skills) |
|--------|-------------------|-----------------|
| File location | `commands/<category>/<name>.md` | `skills/<name>/SKILL.md` |
| File naming | `<name>.md` | `SKILL.md` (uppercase) |
| Organization | Flat files in category folders | Directory per skill |
| Frontmatter | name, description, argument-hint | name, description, argument-hint, + optional fields |
| Arguments | Simple bullet list | Definitions + Values subsections with `$ARGUMENTS` |
| Output | Varied formats | Must return JSON object |

### Section Order (Required)

1. Overview
2. Arguments (with Definitions and Values subsections)
3. Additional Resources (optional)
4. Configuration (optional)
5. Core Principles
6. Skill-Specific Guidelines (optional)
7. Instructions
8. Output Guidance
9. Templates (optional)

### Commands to Convert (19 total)

| Category | Command File | Target Skill Directory |
|----------|-------------|----------------------|
| Setup | `configure-interactive-sdlc.md` | `configure/` |
| Plan | `plan/plan-bug.md` | `plan-bug/` |
| Plan | `plan/plan-chore.md` | `plan-chore/` |
| Plan | `plan/plan-feature.md` | `plan-feature/` |
| Dev | `dev/build.md` | `build/` |
| Dev | `dev/validate.md` | `validate/` |
| Dev | `dev/document.md` | `document/` |
| Workflows | `workflows/one-shot.md` | `one-shot/` |
| Workflows | `workflows/plan-build-validate.md` | `plan-build-validate/` |
| Analyze | `analyze/analyze-bug.md` | `analyze-bug/` |
| Analyze | `analyze/analyze-debt.md` | `analyze-debt/` |
| Analyze | `analyze/analyze-doc.md` | `analyze-doc/` |
| Analyze | `analyze/analyze-security.md` | `analyze-security/` |
| Analyze | `analyze/analyze-style.md` | `analyze-style/` |
| Git | `git/git-branch.md` | `git-branch/` |
| Git | `git/git-commit.md` | `git-commit/` |
| Git | `git/git-pr.md` | `git-pr/` |
| GitHub | `github/create-gh-issue.md` | `create-gh-issue/` |
| GitHub | `github/read-gh-issue.md` | `read-gh-issue/` |

---

## Milestone 1: Foundation

**Objective:** Prepare the repository structure and update the skill template.

### Task 1.1: Copy Skill Template

- Copy `d:\Repositories\agentic-forge\plugins\agentic-sdlc\skills\create-skill\template.md` to `d:\Repositories\clauding\docs\templates\skill-template.md`
- Remove any agentic-specific references (workflow-id mentions in examples)
- Keep all structural elements and conventions

### Task 1.2: Create Skills Directory

- Create `plugins/interactive-sdlc/skills/` directory
- This will contain all skill subdirectories

### Task 1.3: Update CLAUDE.md

- Update file format documentation to mention skills structure
- Update naming conventions section

---

## Milestone 2: Convert Planning Skills

**Objective:** Convert the 4 planning-related commands to skills.

### Task 2.1: Convert configure-interactive-sdlc

- Create `skills/configure/SKILL.md`
- Adapt frontmatter to skill format
- Restructure content to match skill template
- Add JSON output specification

### Task 2.2: Convert plan-bug

- Create `skills/plan-bug/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 2.3: Convert plan-chore

- Create `skills/plan-chore/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 2.4: Convert plan-feature

- Create `skills/plan-feature/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

---

## Milestone 3: Convert Development Skills

**Objective:** Convert development and workflow commands to skills.

### Task 3.1: Convert build

- Create `skills/build/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 3.2: Convert validate

- Create `skills/validate/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 3.3: Convert document

- Create `skills/document/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 3.4: Convert one-shot

- Create `skills/one-shot/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 3.5: Convert plan-build-validate

- Create `skills/plan-build-validate/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

---

## Milestone 4: Convert Analysis Skills

**Objective:** Convert all analysis commands to skills.

### Task 4.1: Convert analyze-bug

- Create `skills/analyze-bug/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 4.2: Convert analyze-debt

- Create `skills/analyze-debt/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 4.3: Convert analyze-doc

- Create `skills/analyze-doc/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 4.4: Convert analyze-security

- Create `skills/analyze-security/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 4.5: Convert analyze-style

- Create `skills/analyze-style/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

---

## Milestone 5: Convert Git and GitHub Skills

**Objective:** Convert version control commands to skills.

### Task 5.1: Convert git-branch

- Create `skills/git-branch/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 5.2: Convert git-commit

- Create `skills/git-commit/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 5.3: Convert git-pr

- Create `skills/git-pr/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 5.4: Convert create-gh-issue

- Create `skills/create-gh-issue/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

### Task 5.5: Convert read-gh-issue

- Create `skills/read-gh-issue/SKILL.md`
- Adapt frontmatter and arguments
- Restructure content
- Add JSON output specification

---

## Milestone 6: Documentation and Cleanup

**Objective:** Update documentation and remove deprecated files.

### Task 6.1: Update Plugin README

- Update README.md to reference skills instead of commands
- Change command table format to skill format
- Update examples to use `/skill-name` format
- Update directory structure documentation

### Task 6.2: Update CHANGELOG

- Add entry for skills migration
- Document breaking changes (if any)

### Task 6.3: Remove Commands Directory

- Remove `plugins/interactive-sdlc/commands/` directory
- Verify no other files reference old command paths

### Task 6.4: Update Root CLAUDE.md

- Update file format documentation
- Update plugin development guidelines
- Update any references to command structure

### Task 6.5: Final Validation

- Run `/normalize` to validate all skills
- Verify all skills have correct structure
- Test a few skills manually

---

## Conversion Template

When converting each command, follow this pattern:

### Original Command Structure

```markdown
---
name: command-name
description: Description
argument-hint: [args]
---

# Title

## Overview
...

## Arguments
- **arg**: description

## Core Principles
...

## Instructions
...

## Output Guidance
...
```

### Target Skill Structure

```markdown
---
name: skill-name
description: Description
argument-hint: [args]
---

# Title

## Overview
2-4 sentences describing what, when, and goal.

## Arguments

### Definitions
- **`<arg>`** (required): Description
- **`[arg]`** (optional): Description. Defaults to `value`.

### Values

$ARGUMENTS

## Core Principles
- Bullet points of key guidelines

## Instructions
1. First step
2. Second step
...

## Output Guidance
Return a JSON object with the following structure:
```json
{
  "success": true,
  "field": "value"
}
```
```

---

## Notes

- Keep all original command content intact - only restructure, do not rewrite
- The interactive-sdlc plugin is scoped to interactive commands, no workflow-id references
- JSON output is mandatory for all skills
- Use `$ARGUMENTS` placeholder in the Values subsection
- Follow kebab-case for skill directory names
- Main file must be named `SKILL.md` (uppercase)
