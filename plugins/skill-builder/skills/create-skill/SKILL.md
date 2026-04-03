---
name: create-skill
description: Create a new Claude Code skill following best practices and guidelines
argument-hint: <skill-name> [context]
disable-model-invocation: true
---

# Create Skill

## Overview

Create a new Claude Code skill following the established guidelines and best practices. This skill guides you through creating a properly structured SKILL.md file with YAML frontmatter and markdown content. Use this when you need to add new functionality to Claude Code as a reusable, invocable skill.

## Arguments

### Definitions

- **`<skill-name>`** (required): The name for the new skill in kebab-case (e.g., `review-code`, `analyze-deps`)
- **`[context]`** (optional): Additional context about what the skill should do

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the skill template structure, see [action-skill-template.md](references/action-skill-template.md)

## Core Principles

- Every skill must be a `SKILL.md` file wrapped in a directory
- Directory name must match the skill name
- Use the template at [action-skill-template.md](references/action-skill-template.md) as the base structure
- Follow the exact section order defined in the template
- Use US English spelling in all content
- Keep descriptions concise and front-load the key use case (truncated at 250 chars in skill listing)
- Keep SKILL.md under 500 lines; move detailed reference material to separate files
- See action-skill-template.md for complete YAML frontmatter field reference and string substitution variables
- Code files must use ASCII only; markdown files may use minimal functional emojis

## Skill-Specific Guidelines

### Directory Structure

Skills must follow this directory structure:

```text
skills/
  my-skill/
    SKILL.md           # Required - main skill definition
    reference.md       # Optional - detailed reference docs
    examples.md        # Optional - usage examples
    scripts/
      helper.py        # Optional - utility scripts
```

The `SKILL.md` file is required. Supporting files are optional and should be referenced from SKILL.md so Claude knows when to load them.

### Argument-Hint Conventions

- Use `<arg>` for required positional arguments (angle brackets)
- Use `[arg]` for optional positional arguments (square brackets)
- Use `[--flag]` for boolean flags (always optional - flags toggle behavior)
- Use `[arg...]` for variadic arguments
- Argument order: flags first, then required args, then optional args
- The `[context]` argument must ALWAYS come last when present
- Flags MUST be boolean-only - NEVER use `--flag <value>` pattern

Examples:

- `<context>` - required context only
- `<type> [context]` - required type, optional context
- `[--verbose] <type> [context]` - flag, required type, optional context
- `[--draft] [--dry-run] <file> [format]` - flags first, then positional

### Positional Argument Access

Claude Code provides string substitution variables to access arguments in skill content:

- **`$ARGUMENTS`** - All arguments as a single string
- **`$ARGUMENTS[N]`** - Access by 0-based index (e.g., `$ARGUMENTS[0]` for first argument)
- **`$N`** - Shorthand for `$ARGUMENTS[N]` (e.g., `$0`, `$1`, `$2`)

Example: `/migrate-component SearchBar React Vue` makes `$0`=SearchBar, `$1`=React, `$2`=Vue available in the skill body. Use these when a skill needs to place specific arguments at different locations in the prompt.

If `$ARGUMENTS` is not present in the skill content, Claude Code appends `ARGUMENTS: <value>` automatically.

### When to Use Invocation Controls

**disable-model-invocation: true** - Only you can invoke:

- Skills with side effects (commit, deploy, send-message)
- Skills where timing matters
- Skills that should not run automatically

**user-invocable: false** - Only Claude can invoke:

- Background knowledge skills
- Context skills that aren't actionable commands
- Skills like `legacy-system-context` that explain how things work

### Forked Context Skills

Add `context: fork` when a skill should run in isolation without conversation history. The skill content becomes the prompt for the subagent. Only use this for skills with explicit task instructions, not just guidelines.

## Instructions

1. **Validate the skill name**
   - Ensure it uses kebab-case (lowercase with hyphens)
   - Verify it does not conflict with existing skills
   - Name should be descriptive of the action

2. **Create the skill directory**
   - Create `plugins/<plugin-name>/skills/<skill-name>/` directory
   - The directory name must match the skill name

3. **Read the template**
   - Load [action-skill-template.md](references/action-skill-template.md)
   - Use it as the base structure for the new skill

4. **Create SKILL.md**
   - Add YAML frontmatter with required fields
   - Fill in all required sections from the template
   - Remove optional sections that don't apply
   - Replace all `{{placeholders}}` with actual content
   - Remove all HTML comment instructions
   - Ensure required arguments precede optional arguments in argument-hint

5. **Validate the skill**
   - Ensure all required sections are present
   - Verify frontmatter fields are correct
   - Check that argument-hint matches Arguments section
   - Confirm required args come before optional args in argument-hint
   - Verify `$ARGUMENTS[N]`/`$N` usage matches argument definitions if used

6. **Add supporting files (if needed)**
   - Create reference.md for detailed documentation
   - Create examples.md for usage examples
   - Reference these files from SKILL.md

## Output Guidance

Provide a brief confirmation message:

**On success:**

```text
Created skill: review-code
Location: plugins/my-plugin/skills/review-code/SKILL.md
Invocation: /review-code

Files created:
- SKILL.md
- references/api-docs.md (if applicable)

Next steps:
- Test the skill with /review-code
- Verify Claude loads it appropriately
- Add to plugin README if user-facing
```

**On error:**

```text
Failed to create skill: <error description>
```
