# Agent-Skills Repository Version Update Reference

## Overview

This reference covers version bumping for agent-skills repositories that contain multiple plugins, each with its own `CHANGELOG.md`. An optional `.claude-plugin/marketplace.json` tracks the marketplace version independently.

## Identifying Changed Plugins

Detect which plugins have changes by examining modified files under `plugins/`:

```bash
git diff main...HEAD --name-only
```

Filter results to identify unique plugin directories: files matching `plugins/<plugin-name>/`.

## Identifying the Latest Release Per Plugin

Read the latest version from each changed plugin's `CHANGELOG.md`:

```bash
head -20 plugins/<plugin-name>/CHANGELOG.md
```

The latest version is the first `## [X.Y.Z]` entry in the file.

## Getting the Diff Per Plugin

For each changed plugin, get the specific diff:

```bash
git diff main...HEAD -- plugins/<plugin-name>/
```

Analyze each plugin's diff independently to determine the appropriate version component.

## Files to Update

### Plugin CHANGELOG.md

For each changed plugin, update `plugins/<plugin-name>/CHANGELOG.md` with a new version entry. Follow the CHANGELOG format defined in the main SKILL.md.

### marketplace.json (if exists)

If `.claude-plugin/marketplace.json` exists, update it:

1. **Plugin versions**: Find each changed plugin's entry in the `plugins` array and update its `version` field
2. **Marketplace root version**: Update `metadata.version` based on the highest change level across all modified plugins:
   - If ANY plugin has a MAJOR change: increment marketplace MAJOR version
   - If ANY plugin has a MINOR change (and no MAJOR): increment marketplace MINOR version
   - If ALL plugins have only PATCH changes: increment marketplace PATCH version

### pyproject.toml (if exists)

If a plugin has a `plugins/<plugin-name>/pyproject.toml` file, update the `version` field in the `[project]` section to match the new plugin version. Plugin versions must be synchronized across all version declarations (CHANGELOG, marketplace.json, pyproject.toml).
