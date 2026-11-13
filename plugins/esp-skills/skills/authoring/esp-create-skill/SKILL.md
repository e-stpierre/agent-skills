---
name: esp-create-skill
description: Create a new Claude Code skill following best practices and guidelines
argument-hint: "-s|--skill <name> [context]"
disable-model-invocation: true
---

# Create Skill

## Overview

Create a new Claude Code skill: a `SKILL.md` with YAML frontmatter and the sections of the skill template, in its own directory, registered in the plugin. Use it to add a reusable, invocable workflow to a plugin.

## Arguments

### Definitions

- **`-s|--skill <name>`** (required): The name of the new skill in kebab-case (e.g., `esp-review-code`). Read it from `-s` or `--skill`.
- **`[context]`** (optional): What the skill should do: the trailing free text after the options.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the section structure, the frontmatter fields and the string substitutions, see [action-skill-template.md](references/action-skill-template.md)

## Core Principles

- The template is the structure: its sections, in its order, with its exact names
- Use US English spelling. Code files are ASCII only; markdown files may add minimal functional emojis
- Keep SKILL.md under 500 lines: material only some branches need goes to `references/` behind a pointer that says when to read it
- The description decides invocation: a user-invoked skill (`disable-model-invocation: true`) gets a one-line human summary; a model-invoked skill front-loads what it is, then one trigger per distinct case, no synonyms. The listing truncates it at 250 characters
- Write steps that end on a checkable done-condition, and state each target behavior positively; keep a prohibition only for a hard guardrail, paired with what to do instead

## Skill-Specific Guidelines

### Directory Structure

```text
plugins/<plugin-name>/skills/<category>/<skill-name>/
  SKILL.md        # Required - main skill definition, name matches the directory
  references/     # Optional - reference docs loaded on demand
  scripts/        # Optional - executable code
  assets/         # Optional - templates, schemas, static files
```

Link every supporting file from SKILL.md with the condition for reading it, one level deep.

### Argument Conventions

Skills take arguments like a standard CLI: every discrete value is a named option, and only free text is positional.

Notation in `argument-hint` and Definitions:

- `<value>` is a required placeholder
- `[...]` is optional
- `a|b` is alternatives (`-t|--type`)
- `...` is repeatable (`[-r|--reviewers <name>...]`)

Rules:

- **Options**: every discrete value (a name, a type, a number, a path, a PR, a ref) is an option with a short and a long name: `-t|--type <type>`. `--type=<value>` works too. Long names are kebab-case; short names are one letter, lowercase first, uppercase only when the lowercase letter is taken
- **Required or optional**: a required option is bare (`-t|--type <type>`), an optional one is bracketed (`[-b|--base <branch>]`) and documents its default
- **Flags**: boolean switches are optional and take a short name too (`[-w|--draft]`). Presence turns the behavior on
- **Repeatable values**: `...` marks an option given several times (`-r claude -r codex`); a comma-separated value (`-r claude,codex`) is accepted too
- **Free text**: one trailing positional, for prose the user types (`<question>`, `[context]`). Nothing else is positional
- **Subcommands**: a skill that is a set of actions (`esp-config`) takes the action as a leading positional (`<action>`); its values are still options
- **Order**: subcommand, flags, required options, optional options, free text
- **Keep the hint short**: it is display text only. The skill body spells out how to read each option, by both names ("If `-n` or `--dry-run` is present, list changes without writing")

Reserved short letters, never used for another meaning: `-h` help, `-v` verbose, `-q` quiet, `-f` force, `-o` output, `-n` dry-run, `-y` yes (skip confirmation).

Plugin-wide short letters, never used for another meaning:

- `-d|--run-dir <path>`
- `-c|--config-snapshot <path>`
- `-i|--interactive <mode>`
- `-r|--reviewers <name>...`
- `-p|--pr <pr>` or `-p|--plan <path>` (no skill takes both)
- `-u|--resume`

Examples:

- `<question>` - free text only
- `-t|--type <type> [context]` - required option, free text
- `[-w|--draft] [-b|--base <branch>]` - flag, optional option
- `[-a|--amend] [-t|--type <type>] [-d|--run-dir <path>] [context]` - flag, options, free text
- `<action> [-P|--project] [-k|--key <key>] [value]` - subcommand, flag, option, free text

### Argument Access

Read options by name from `Arguments: $ARGUMENTS` in the Values subsection. Positional substitutions (`$ARGUMENTS[N]`, `$N`) shift when an option is added or omitted, so options-based skills do not use them.

### When to Use Invocation Controls

**`disable-model-invocation: true`** - only the user invokes it:

- Skills with side effects (commit, deploy, send a message)
- Skills where timing matters

**`user-invocable: false`** - only Claude invokes it:

- Background knowledge that is not an actionable command (e.g., a `legacy-system-context` skill explaining how a system works)

Omit both for a skill the user types and Claude also reaches on its own.

### Forked Context Skills

Add `context: fork` when a skill should run in isolation without conversation history: its content becomes the subagent's prompt, so reserve it for skills with explicit task instructions.

### Avoid Tables

A skill is read in raw form, where a table is hard to scan and easy to break. Write a list of `**Key**: effect` items, or one sentence per option, so each item keeps every value its row would hold, for example `- **merge.method** (default repo): the merge method`.

Keep a table only when the reader compares several attributes across many rows and a list would repeat the same labels on every item, such as a matrix of check marks. A config key with its default and its effect is still a list, even for ten or more keys.

## Instructions

1. **Validate the name**: kebab-case, describes the action, and unused: a search for `<skill-name>` across `plugins/*/skills/` finds no existing directory.
2. **Create the directory** `plugins/<plugin-name>/skills/<category>/<skill-name>/`, reusing an existing category when one fits. When the plugin's `.claude-plugin/plugin.json` has a `skills` array, add `./skills/<category>/<skill-name>` to it so the skill ships.
3. **Read the template** [action-skill-template.md](references/action-skill-template.md) in full.
4. **Write SKILL.md** from the template and `[context]`: frontmatter on line 1 with the fields that apply, every required section, the optional ones that apply, and every value defined as an option per [Argument Conventions](#argument-conventions). Supporting files go under `references/`, `scripts/` or `assets/`, each linked from SKILL.md.
5. **Validate** until every check passes:
   - No `{{` placeholder and no template `<!--` instruction comment remains
   - Section names and order match the template; Skill-Specific Guidelines are `###` subsections
   - `argument-hint` (quoted) matches the Definitions option for option, in the order of [Argument Conventions](#argument-conventions)
   - Every option has a unique short name, no reserved letter is reused, shared options use the plugin-wide letters, and the body reads each option by both names
   - The file is under 500 lines, US English, and ASCII apart from functional emojis

## Output Guidance

Provide a brief confirmation message:

**On success:**

```text
Created skill: esp-review-code
Location: plugins/esp-skills/skills/review/esp-review-code/SKILL.md
Invocation: /esp-skills:esp-review-code

Files created:
- SKILL.md
- references/api-docs.md (if applicable)

Next steps:
- Test the skill with /esp-skills:esp-review-code
- Verify Claude loads it appropriately
- Add to plugin README if user-facing
```

**On error:**

```text
Failed to create skill: <error description>
```
