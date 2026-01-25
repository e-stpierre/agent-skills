---
name: configure-interactive-sdlc
description: Set up interactive-sdlc plugin configuration interactively
---

# Configure interactive-sdlc

## Overview

Set up interactive-sdlc plugin configuration interactively by reading existing settings, validating them, and prompting for missing or invalid values.

## Core Principles

- Configuration is stored in `.claude/configs/interactive-sdlc.json`
- All paths are relative to project root
- Users can gitignore the config file if they want personal settings
- Validate all user input before accepting
- Ensure all settings are within valid ranges
- If configuration file doesn't exist, create the directory and file
- If file exists but is invalid JSON, warn the user, offer to backup, and create new valid configuration
- If user provides invalid input, show error message explaining valid values and re-prompt
- If file permission issues prevent automatic updates, provide manual configuration instructions

## Instructions

1. **Read Existing Configuration**
   - Check if `.claude/configs/interactive-sdlc.json` exists
   - Parse current settings if present
   - Identify which settings are missing or invalid

2. **Validate Current Configuration**
   Check each setting against expected schema:

   | Setting                        | Type   | Valid Range | Default      |
   | ------------------------------ | ------ | ----------- | ------------ |
   | `planDirectory`                | string | Valid path  | `"specs"`    |
   | `analysisDirectory`            | string | Valid path  | `"analysis"` |
   | `defaultExploreAgents.chore`   | number | 0-5         | `2`          |
   | `defaultExploreAgents.bug`     | number | 0-5         | `2`          |
   | `defaultExploreAgents.feature` | number | 0-10        | `3`          |

3. **If Configuration is Valid and Complete**
   - Display success message
   - Show current configuration summary
   - Inform user they can edit `.claude/configs/interactive-sdlc.json` directly for changes
   - Exit command

4. **If Configuration is Missing or Invalid**
   - Use AskUserQuestion to gather missing/invalid values
   - Show current values as defaults in questions
   - Validate user inputs before accepting

   **Questions to ask:**
   - Where should plan files be saved? (default: `/specs`)
   - Where should analysis reports be saved? (default: `/analysis`)
   - How many explore agents for chore planning? (0-5, default: 2)
   - How many explore agents for bug planning? (0-5, default: 2)
   - How many explore agents for feature planning? (0-10, default: 3)

5. **Update Configuration**
   - Create `.claude/configs/` directory if it doesn't exist
   - Create or update `.claude/configs/interactive-sdlc.json`
   - Confirm successful configuration with summary

## Configuration

### Configuration File (`.claude/configs/interactive-sdlc.json`)

```json
{
  "planDirectory": "specs",
  "analysisDirectory": "analysis",
  "defaultExploreAgents": {
    "chore": 2,
    "bug": 2,
    "feature": 3
  }
}
```

Users can gitignore this file if they want personal settings.

## Output Guidance

Show current configuration status and changes made:

**If configuration is valid:**

```
Configuration is valid

Current interactive-sdlc configuration:
  planDirectory: specs
  analysisDirectory: analysis
  defaultExploreAgents:
    chore: 2
    bug: 2
    feature: 3

To change settings, edit .claude/configs/interactive-sdlc.json directly
or run /configure-interactive-sdlc again.
```

**If configuration needed updates:**

```
Configuration updated successfully!

Current configuration:
  planDirectory: specs
  analysisDirectory: analysis
  defaultExploreAgents:
    chore: 2
    bug: 2
    feature: 3

Configuration saved to .claude/configs/interactive-sdlc.json

To change settings later, edit .claude/configs/interactive-sdlc.json directly
or run /configure-interactive-sdlc again.
```
