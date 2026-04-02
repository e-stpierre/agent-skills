<!--
SKILL PROMPT TEMPLATE

This template defines the exact structure for Claude Code skill prompts.

FILE SIZE LIMIT:
- Keep SKILL.md under 500 lines. Move detailed reference material to separate files.

DIRECTORY STRUCTURE:
A skill is a directory containing at minimum a SKILL.md file. Optional directories:
- scripts/   - Executable code that agents can run (Python, Bash, JavaScript)
- references/ - Additional documentation (REFERENCE.md, domain-specific files)
- assets/    - Static resources (templates, images, data files, schemas)

Keep file references one level deep from SKILL.md. Avoid deeply nested reference chains.

YAML FRONTMATTER:
Every skill requires YAML frontmatter between `---` markers at the top of SKILL.md.

Agent Skills Standard Fields:
| Field         | Required | Description                                                                                 |
| ------------- | -------- | ------------------------------------------------------------------------------------------- |
| name          | Yes      | Max 64 chars. Lowercase letters, numbers, hyphens only. Must match parent directory name.   |
|               |          | Must not start/end with hyphen or contain consecutive hyphens (--).                         |
| description   | Yes      | Max 1024 chars. Describes what the skill does and when to use it.                           |
| license       | No       | License name or reference to a bundled license file (e.g., `Apache-2.0`, `LICENSE.txt`).    |
| compatibility | No       | Max 500 chars. Environment requirements (system packages, network access, etc.).            |
| metadata      | No       | Arbitrary key-value mapping for additional properties (author, version, etc.).              |
| allowed-tools | No       | Space-delimited list of pre-approved tools the skill may use.                               |

Claude Code Specific Fields:
| Field                    | Required | Description                                                                                 |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------- |
| argument-hint            | No       | Hint shown during autocomplete for expected arguments.                                      |
| disable-model-invocation | No       | Set `true` to prevent Claude from auto-loading. Use for side-effect skills. Default: false. |
| user-invocable           | No       | Set `false` to hide from / menu. Use for background knowledge. Default: true.               |
| model                    | No       | Model to use when this skill is active.                                                     |
| effort                   | No       | Effort level when active. Overrides session level. Options: low, medium, high, max.         |
| context                  | No       | Set to `fork` to run in a forked subagent context (no conversation history).                |
| agent                    | No       | Which subagent type to use when `context: fork` is set.                                     |
| hooks                    | No       | Hooks scoped to this skill's lifecycle.                                                     |
| paths                    | No       | Glob patterns limiting when skill activates. Comma-separated or YAML list.                  |
| shell                    | No       | Shell for !`command` blocks. Options: bash (default), powershell.                           |

ARGUMENT-HINT CONVENTIONS:
- Use `<arg>` for required positional arguments (angle brackets)
- Use `[arg]` for optional positional arguments (square brackets)
- Use `[--flag]` for boolean flags (always optional - flags toggle behavior)
- Use `[arg...]` for variadic arguments (accepts multiple values)
- Argument order: flags first, then required args, then optional args
- The `[context]` argument must ALWAYS come last when present
- Examples:
  - `<context>` - required context only
  - `<type> [context]` - required type, optional context
  - `[--verbose] <type> [context]` - flag, required type, optional context
  - `[--draft] [--dry-run] <file> [format]` - flags first, then positional

ARGUMENT-HINT VALIDATION RULES:
- Flags (`[--flag]`) must come first, before all positional arguments
- Required arguments (`<arg>`) must precede optional arguments (`[arg]`)
- Flags MUST be boolean-only (presence/absence toggles)
- NEVER use `--flag <value>` pattern - flags do not take values
- For named values, use positional arguments with descriptive names
- Wrong: `--level <level> --step <name>` (flags with values)
- Correct: `<level> <step>` (positional arguments)
- Wrong: `--type critical` (flag taking a value)
- Correct: `<type>` with valid values documented in Definitions

STRING SUBSTITUTIONS:
Claude Code replaces these variables in skill content before sending to the model:

| Variable               | Description                                                                    |
| ---------------------- | ------------------------------------------------------------------------------ |
| $ARGUMENTS             | All arguments as a single string. Appended as `ARGUMENTS: <value>` if absent.  |
| $ARGUMENTS[N]          | Access a specific argument by 0-based index (e.g., $ARGUMENTS[0] for first).   |
| $N                     | Shorthand for $ARGUMENTS[N] (e.g., $0 for first, $1 for second).              |
| ${CLAUDE_SESSION_ID}   | Current session ID. Useful for logging or session-specific files.              |
| ${CLAUDE_SKILL_DIR}    | Directory containing this SKILL.md. Use in !`command` to reference bundled     |
|                        | scripts/files regardless of working directory.                                 |

POSITIONAL ARGUMENT ACCESS:
When a skill needs to reference individual arguments, use $ARGUMENTS[N] or the $N shorthand:
- `/my-skill SearchBar React Vue` -> $0=SearchBar, $1=React, $2=Vue
- $ARGUMENTS still contains the full string "SearchBar React Vue"
- If $ARGUMENTS is not present in content, arguments are appended as `ARGUMENTS: <value>`

DYNAMIC CONTEXT INJECTION:
- Use `!`command`` syntax to run shell commands before skill content is sent to Claude.
- The command output replaces the placeholder. Example: `!`git status`` inserts current git status.
- Use ${CLAUDE_SKILL_DIR} to reference scripts bundled with the skill.

REQUIRED SECTIONS (in order):
1. Overview - Skill purpose and objective (combines definition + goal)
2. Arguments - Only if skill takes arguments (must include Definitions and Values subsections)
3. Core Principles - Key guidelines, constraints, and important notes
4. Instructions - Step-by-step execution guide
5. Output Guidance - Expected output format (human-readable text)

OPTIONAL SECTIONS (insert in order shown):
- Additional Resources - After Arguments, for links to supporting files
- Skill-Specific Guidelines - After Core Principles, for domain-specific guidance
- Templates - After Output Guidance, for structured output templates

SECTION ORDER MUST BE RESPECTED - Follow the order defined above.

VALIDATION RULES:
- Arguments section and argument-hint frontmatter are REQUIRED only when the skill takes arguments
- Arguments section and argument-hint should be OMITTED when the skill takes no arguments
- Interactive skills output human-readable text (not JSON) for direct user consumption
-->

---

name: {{skill-name}}
description: {{skill-description}}
argument-hint: {{argument-pattern}}

---

# {{skill_title}}

## Overview

{{overview}}

<!--
Instructions:
- Replace {{overview}} with 2-4 sentences describing:
  - What the skill does
  - When to use it
  - The primary goal it achieves
- This section combines the skill definition and objective
-->

## Arguments

### Definitions

{{argument_definitions}}

<!--
Instructions:
- Replace {{argument_definitions}} with a bullet-point list defining each argument
- Format: **`<argument-name>`** (required): Description
- Format: **`[argument-name]`** (optional): Description. Defaults to `value`.
- List required arguments before optional arguments (matching argument-hint order)
- Include default values where applicable
- The [context] argument should always come last
- Reference positional index when the skill uses $ARGUMENTS[N] or $N shorthand
- Omit this section entirely if the skill takes no arguments
-->

### Values

Arguments: $ARGUMENTS

<!--
Instructions:
- MUST use the `Arguments: $ARGUMENTS` format (with the "Arguments:" prefix)
- Using `$ARGUMENTS` alone on a line breaks markdown syntax because the dollar sign
  is interpreted as a LaTeX/math delimiter by some renderers
- The $ARGUMENTS placeholder is automatically replaced with all arguments passed when invoking the skill
- If $ARGUMENTS is not present in the content, arguments are appended as `ARGUMENTS: <value>`
- Use $ARGUMENTS[N] or $N shorthand in the skill body to reference specific positional arguments
- Do not modify this subsection
-->

## Additional Resources (optional)

{{additional_resources}}

<!--
Instructions:
- Replace {{additional_resources}} with links to supporting files
- Format: - For <purpose>, see [filename.md](filename.md)
- Use for reference docs, examples, or scripts in the skill directory
- Omit this section if skill has no supporting files
-->

## Core Principles

{{principles}}

<!--
Instructions:
- Replace {{principles}} with bullet points of key guidelines
- Include constraints, quality standards, and behavioral expectations
- Include security considerations where relevant
- Include critical warnings and important notes
- Use positive format where possible ("Do X" instead of "Don't do X")
- Reserve "Don't" for critical warnings where violation would cause serious issues
-->

## Skill-Specific Guidelines (optional)

{{skill_specific_guidelines}}

<!--
Instructions:
- Replace {{skill_specific_guidelines}} with domain-specific behavioral guidance
- Each guideline must be in a sub-section (###) with a clear, descriptive title
- Use for specialized context that doesn't fit standard sections
- Include examples, conventions, or patterns specific to this skill's domain
- Omit this section if not needed
-->

## Instructions

{{instructions}}

<!--
Instructions:
- Replace {{instructions}} with numbered step-by-step execution instructions
- Use format: 1. First action, 2. Second action, etc.
- Provide logical sequence from start to completion
- Include verification or validation steps
-->

## Output Guidance

{{output}}

<!--
Instructions:
- Replace {{output}} with expected output format and content definition
- Interactive skills output human-readable text for direct user consumption
- Skills may also produce additional outputs (e.g., create files, write markdown) during execution
- Define the expected text format and key information to include
- Use clear headings and formatting for readability
-->

## Templates (optional)

{{templates}}

<!--
Instructions:
- Replace {{templates}} with embedded templates for structured outputs
- Use code blocks to show template structure
- Include placeholders with clear naming (e.g., [Feature Name], {{variable}})
- Document each section of the template
- This section is recommended for skills that generate files or structured output
-->
