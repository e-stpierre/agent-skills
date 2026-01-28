# Claude

## Project Overview

This repository is a collection of modular extensions for Claude Code. It serves as a centralized hub for reusable agents, skills, hooks, configuration templates that enhance Claude Code's capabilities across diverse tasks and domains.

## Purpose

The `clauding` repository aims to offer ready-to-use components that solve common problems.

## Repository Structure

### `/docs/`

Comprehensive documentation for plugin development and usage.
This directory also contains template files for agent and skill. These templates must be respected when creating a new prompt.

### `/plugins/`

Root directory containing all plugins. Each plugin is self-contained within its own subdirectory.

### `/plugins/<plugin-name>/`

Individual plugin directory structure that is organized with one directory per prompt type. Sub-directories can be used within a prompt type to organize it's content.

#### `agents/`

Sub-agent configurations for specialized, autonomous task execution. Agents should be self-contained and focused on a specific domain or task.

#### `skills/`

Reusable skill modules that provide composable functionality. Each skill is a directory containing:

- `SKILL.md` (required) - Main skill definition file (uppercase)
- `references/` (optional) - Additional documentation files
- `scripts/` (optional) - Executable code for the skill
- `assets/` (optional) - Static resources (templates, schemas)

#### `hooks/`

Runtime hooks that execute on specific events (session start, tool calls, etc.).

#### `CHANGELOG.md`

Plugin-specific version history.

#### `README.md`

Plugin-specific documentation. Should only contain information specific to this plugin, not general marketplace or installation instructions.

The README must contain an initial section called `Overview` that allow a user to understand the plugin and how to use with a few examples it in 2 minute.

The README must also have a complete example section at the end, that covers all the supported skills and arguments, with examples.

## Plugin Development Guidelines

### Language Style

Use US English spelling in all code, comments, documentation, and UI strings when a word has both UK and US variants (e.g., "analyze" not "analyse", "color" not "colour", "canceled" not "cancelled").

### Naming Conventions

- **Agents**: Use descriptive names with domain prefix (e.g., `devops-agent.md`, `test-agent.md`)
- **Skills**: Use kebab-case directory names (e.g., `git-branch/`, `sdlc-plan/`) with `SKILL.md` inside
- **Hooks**: Include event name (e.g., `session-start-hook.sh`, `tool-call-hook.sh`)

### Documentation Guidelines

- **Keep READMEs concise**: Plugin READMEs should only contain plugin-specific information
- **Avoid duplication**: Do not repeat information from the root README (installation, marketplace setup, contributing guidelines, license, support)
- **CHANGELOGs should be brief**: Focus on what changed, not detailed explanations
- **Link to root docs**: Reference the root README or `/docs/` for general information
- **ASCII only**: Use only valid ASCII characters in all files to avoid encoding issues across platforms
- **Workflow diagrams**: Use arrow notation (`->`) for workflow documentation instead of long multi-line ASCII boxes. Example: `Plan -> Implement -> Validate -> Output` is preferred over complex box diagrams

### File Formats

- **Agents**: Markdown (`.md`) files in `plugins/<plugin-name>/agents/`
- **Skills**: Directory per skill in `plugins/<plugin-name>/skills/<skill-name>/SKILL.md`
- **Hooks**: Shell scripts (`.sh`) or executable programs in `plugins/<plugin-name>/hooks/`

### Prompt Template Convention

All prompt files (agents, skills) and plugin READMEs must follow the exact structure defined in the template files located in `docs/templates/`:

- `docs/templates/agent-template.md` - Structure for agent prompts
- `docs/templates/skill-template.md` - Structure for skill prompts
- `docs/templates/readme-template.md` - Structure for plugin README files

**Placeholder Convention:**

Prompt templates use **Mustache/Handlebars-style placeholders** with the following format:

```markdown
## {{section_title}}

{{content}}

<!--
Instructions:
- Replace {{content}} with the actual content
- Additional guidance for this section
- Suggested elements (include others as needed):
  - Element 1
  - Element 2
-->
```

**Key principles:**

- Use `{{variable_name}}` for all placeholders (not `<placeholder>` or other formats)
- Include HTML comments with instructions below each section
- Mark suggested elements as "include others as needed" to allow flexibility
- Required sections must be present; optional sections can be omitted
- Section names must match the template exactly (case-sensitive)

**Validation:**

Use the `/normalize` skill to validate prompt files against templates:

```bash
# Validate all prompts in the repository
/normalize

# Validate specific files or directories
/normalize plugins/my-plugin/skills/

# Auto-fix non-compliant files
/normalize --autofix plugins/my-plugin/
```

### Workflow Skill Namespacing

Skills referenced in workflow YAML files must use the full plugin namespace to avoid ambiguity when multiple plugins provide skills with the same name.

**Required format in workflows:**

```yaml
# Correct - explicit namespace
- type: skill
  skill: clauding:sdlc-review

# Incorrect - ambiguous, could match multiple plugins
- type: skill
  skill: sdlc-review
```

### Code Style and Formatting

CI validates format, lint, and tests on all pull requests. Run locally before opening a pull request:

```bash
pnpm check          # Format and lint
```
