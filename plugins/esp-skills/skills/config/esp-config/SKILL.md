---
name: esp-config
description: Initialize, show, get, set, and validate esp-skills configuration
argument-hint: "<action> [-P|--project] [-f|--force] [-k|--key <key>] [value]"
disable-model-invocation: true
---

# ESP Config

## Overview

Manage the esp-skills configuration through the plugin's `config.mjs` script: create a starter config file, inspect the merged configuration, read or change one key, and validate config files. Configuration is optional: every skill falls back to the built-in defaults when no file exists.

## Arguments

### Definitions

- **`<action>`** (required): The leading word, one of:
  - `init` - Create a starter config file
  - `show` - Print the full merged config
  - `get` - Print one section or dotted key (e.g., `pr`, `pr.draft`, `defaults.models.reviewer`)
  - `set` - Set a key to a value in the user or project file
  - `unset` - Remove a key from the user or project file
  - `validate` - Validate every layer, or one file when `--key` is a file path
  - `sources` - List the config layers and which ones are in use
- **`[-P|--project]`** (optional): Target the project file (`<repo>/.esp-skills/config.json`) instead of the user file (`~/.esp-skills/config.json`) for `init`, `set`, and `unset`.
- **`[-f|--force]`** (optional): Overwrite an existing file on `init`.
- **`[-k|--key <key>]`** (optional): Section or dotted key for `get`, `set`, `unset` (required by those three). A file path for `validate`.
- **`[value]`** (optional): The trailing free text, the value for `set`. Parsed as JSON when valid (`true`, `3`, `null`, `["a"]`), otherwise used as a plain string.

### Values

Arguments: $ARGUMENTS

## Core Principles

- Every read and write goes through `config.mjs`, which validates each write before saving it; config files are never edited by hand in this skill
- Config files hold no secrets (tokens, passwords, API keys)
- A failed `set` leaves the file unchanged; report the script's error verbatim, it names the key path and the expected type
- Only `init`, `set`, and `unset` write files; every other action is read-only

## Skill-Specific Guidelines

### Layers

The script merges these layers, lowest to highest precedence:

1. Built-in defaults: `${CLAUDE_PLUGIN_ROOT}/references/config-defaults.json`
2. User config: `~/.esp-skills/config.json` (the `ESP_SKILLS_HOME` environment variable overrides `~/.esp-skills`)
3. Project config: `<repo>/.esp-skills/config.json`, where `<repo>` is the nearest git root
4. Config snapshot (`--config-snapshot <path>`): replaces the user and project layers for one run; defaults still fill missing keys

Skill arguments override the resolved values in the skill that receives them. Objects merge key by key; arrays and scalar values replace the lower layer.

### Schema

Files are validated against `${CLAUDE_PLUGIN_ROOT}/references/config.schema.json`. Add `"$schema": "https://raw.githubusercontent.com/e-stpierre/skills/main/plugins/esp-skills/references/config.schema.json"` to a config file for editor completion; `init` adds it. Keys marked "Reserved" in the schema belong to skills that are not shipped yet.

## Instructions

1. Parse the arguments into the action, the flags, the key and the value. If the action is missing or unknown, list the valid actions and stop.
2. Build the command; the script takes the key and the value as positionals:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" <action> [key] [value] [--project] [--force]
   ```

   - Quote the value so the shell passes it as one argument (e.g., `'["squash","merge"]'`)
   - For `validate` with a file path, pass the path in the key position

3. Run the command from the current working directory so the project layer resolves to the current repository.
4. Read the exit code:
   - `0`: success, the output is JSON
   - `1`: invalid config or failed operation, the error names the file, key path and expected type
   - `2`: usage error (unknown action, unknown key, missing value)
5. Report the result per the Output Guidance, with the JSON the script printed for a read action.

## Output Guidance

Keep the output short.

**On `get` or `show`:**

````text
pr (merged from defaults, user)

```json
{ "base": null, "draft": true, "attribution": true }
```
````

**On `init`, `set`, or `unset`:**

```text
Set pr.draft = true in ~/.esp-skills/config.json
```

**On `validate`:**

```text
Config is valid: defaults, ~/.esp-skills/config.json
```

**On error:**

```text
Invalid config in ~/.esp-skills/config.json:
  pr.draft: expected boolean, got string "yes"
```
