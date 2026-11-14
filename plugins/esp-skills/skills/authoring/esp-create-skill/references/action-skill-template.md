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
Every skill requires YAML frontmatter between `---` markers, starting on line 1 of SKILL.md
with no blank line inside (the blank lines below come from this template being markdown).

Agent Skills Standard Fields:
- name (required): max 64 chars. Lowercase letters, numbers, hyphens only. Must match parent directory name.
  Must not start/end with hyphen or contain consecutive hyphens (--).
- description (required): max 1024 chars. Describes what the skill does and when to use it.
  Model-invoked: front-load what it is, then one trigger per distinct case. User-invoked: a one-line summary.
- license (optional): license name or reference to a bundled license file (e.g., `Apache-2.0`, `LICENSE.txt`).
- compatibility (optional): max 500 chars. Environment requirements (system packages, network access, etc.).
- metadata (optional): arbitrary key-value mapping for additional properties (author, version, etc.).
- allowed-tools (optional): space-delimited list of pre-approved tools the skill may use.

Claude Code Specific Fields:
All optional:
- argument-hint: hint shown during autocomplete for expected arguments.
- disable-model-invocation: set `true` to prevent Claude from auto-loading. Use for side-effect skills. Default: false.
- user-invocable: set `false` to hide from / menu. Use for background knowledge. Default: true.
- model: model to use when this skill is active.
- effort: effort level when active. Overrides session level. Options: low, medium, high, max.
- context: set to `fork` to run in a forked subagent context (no conversation history).
- agent: which subagent type to use when `context: fork` is set.
- hooks: hooks scoped to this skill's lifecycle.
- paths: glob patterns limiting when skill activates. Comma-separated or YAML list.
- shell: shell for !`command` blocks. Options: bash (default), powershell.

ARGUMENT CONVENTIONS:
Skills take arguments like a standard CLI: every discrete value is a named option with a short
and a long name, and only free text is positional. The full rules (notation, order, reserved and
plugin-wide short letters) are in the Argument Conventions section of esp-create-skill SKILL.md.

STRING SUBSTITUTIONS:
Claude Code replaces these variables in skill content before sending to the model:

- $ARGUMENTS: all arguments as a single string. Appended as `ARGUMENTS: <value>` if absent.
- $ARGUMENTS[N]: access a specific argument by 0-based index (e.g., $ARGUMENTS[0] for first).
- $N: shorthand for $ARGUMENTS[N] (e.g., $0 for first, $1 for second).
- ${CLAUDE_SESSION_ID}: current session ID. Useful for logging or session-specific files.
- ${CLAUDE_SKILL_DIR}: directory containing this SKILL.md. Use in !`command` to reference bundled
  scripts/files regardless of working directory.

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
<!-- markdownlint-disable MD041 -->

---

name: {{skill-name}}
description: {{skill-description}}
argument-hint: "{{argument-pattern}}"

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
- Format: **`-t|--type <type>`** (required): Description, with the valid values
- Format: **`[-b|--base <branch>]`** (optional): Description. Defaults to `value`.
- Format: **`[-w|--draft]`** (optional): What the flag turns on
- Format: **`[context]`** (optional): The free text, always last
- List them in argument-hint order
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
- Do not modify this subsection
-->

## Additional Resources (optional)

{{additional_resources}}

<!--
Instructions:
- Replace {{additional_resources}} with links to supporting files
- Format: - For <purpose>, see [filename.md](filename.md)
- State when to read each file (e.g., "read it before creating a new file"), so the pointer fires on the right branch
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
- State the target behavior positively ("Do X" instead of "Don't do X")
- Reserve "Don't" for hard guardrails where violation would cause serious issues, and pair it with what to do instead
-->

## Skill-Specific Guidelines (optional)

{{skill_specific_guidelines}}

<!--
Instructions:
- Replace {{skill_specific_guidelines}} with domain-specific behavioral guidance
- Each guideline must be in a sub-section (###) with a clear, descriptive title
- Use for specialized context that doesn't fit standard sections
- Include examples, conventions, or patterns specific to this skill's domain
- Avoid tables: write `**Key**: effect` lists or one sentence per option. Keep a table only for a true grid (several attributes compared across many rows)
- Omit this section if not needed
-->

## Instructions

{{instructions}}

<!--
Instructions:
- Replace {{instructions}} with numbered step-by-step execution instructions
- Use format: 1. First action, 2. Second action, etc.
- Provide logical sequence from start to completion
- End each step on a checkable completion criterion (e.g., "Done when `git branch --show-current` prints the new name")
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
