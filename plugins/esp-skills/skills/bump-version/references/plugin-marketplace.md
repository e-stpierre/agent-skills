# Plugin Marketplace Repository Version Update Reference

## Overview

This reference covers version bumping for plugin marketplace repositories: a repository with a `plugins/` directory containing one or more plugins, usually listed in `.claude-plugin/marketplace.json`. The same flow applies whether the repository ships a single plugin or many.

There are two levels of changelogs:

1. **Root `CHANGELOG.md`**: A high-level changelog at the repository root that summarizes major changes across the entire project (e.g., "Added `qna` and `rubberduck` skills to the helpers plugin"). Only include plugin-level summaries here, not detailed per-skill changes.
2. **Plugin `plugins/<plugin-name>/CHANGELOG.md`**: A detailed changelog per plugin that tracks all changes specific to that plugin.

Plugin versions can be declared in two places:

- `.claude-plugin/marketplace.json`: the `version` field of the plugin's entry in the `plugins` array (always used for `strict: false` plugins, which have no manifest)
- `plugins/<plugin-name>/.claude-plugin/plugin.json`: the plugin manifest's `version` field, when the plugin has one

The marketplace itself has its own version in `metadata.version`, tracked independently from plugin versions.

## Identifying Changed Plugins

Detect which plugins have changes by examining modified files under `plugins/`:

```bash
git diff main...HEAD --name-only
```

Filter results to identify unique plugin directories: files matching `plugins/<plugin-name>/`. In a single-plugin repository, this is always the same plugin.

## Identifying the Latest Release Per Plugin

Read the latest version from each changed plugin's `CHANGELOG.md`:

```bash
head -20 plugins/<plugin-name>/CHANGELOG.md
```

The latest version is the first `## X.Y.Z` entry in the file.

## Getting the Diff Per Plugin

For each changed plugin, get the specific diff:

```bash
git diff main...HEAD -- plugins/<plugin-name>/
```

Analyze each plugin's diff independently to determine the appropriate version component.

## Files to Update

### Root CHANGELOG.md

Update the root `CHANGELOG.md` with a high-level summary entry for the new marketplace version. Each entry should describe changes at the plugin level, not individual skill-level details. Detailed changes belong in the plugin-level changelogs.

### Plugin CHANGELOG.md

For each changed plugin, update `plugins/<plugin-name>/CHANGELOG.md` with a new version entry. Follow the CHANGELOG format defined in the main SKILL.md.

### plugin.json (if exists)

If a changed plugin has a `plugins/<plugin-name>/.claude-plugin/plugin.json` manifest, update its `version` field to the new plugin version.

### marketplace.json (if exists)

If `.claude-plugin/marketplace.json` exists, update it:

1. **Plugin versions**: Find each changed plugin's entry in the `plugins` array and update its `version` field (if the entry declares one)
2. **Marketplace root version**: Update `metadata.version` based on the highest change level across all modified plugins:
   - If ANY plugin has a MAJOR change: increment marketplace MAJOR version
   - If ANY plugin has a MINOR change (and no MAJOR): increment marketplace MINOR version
   - If ALL plugins have only PATCH changes: increment marketplace PATCH version

### pyproject.toml (if exists)

If a plugin has a `plugins/<plugin-name>/pyproject.toml` file, update the `version` field in the `[project]` section to match the new plugin version.

Plugin versions must be synchronized across all version declarations (CHANGELOG, plugin.json, marketplace.json, pyproject.toml).
