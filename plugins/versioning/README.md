# Versioning

## Overview

Automated version management for libraries and plugin repositories. Analyzes changes since the last release, updates CHANGELOGs following Keep a Changelog format, and bumps version numbers using semantic versioning. Supports npm packages with a single root CHANGELOG and agent-skills repositories with per-plugin CHANGELOGs.

- `/bump-version` - Auto-detect changes and bump the appropriate version
- `/bump-version minor` - Explicitly bump the minor version

## Skills

| Skill           | Description                                              |
| --------------- | -------------------------------------------------------- |
| `/bump-version` | Update version numbers and CHANGELOGs based on changes   |

## Complete Examples

### /bump-version

**Arguments:**

- `[version-component]` - Version component to increment: `major`, `minor`, or `patch` (auto-detected if omitted)

**Examples:**

```bash
# Auto-detect version component from changes
/bump-version

# Explicitly bump patch version
/bump-version patch

# Explicitly bump minor version
/bump-version minor

# Explicitly bump major version for breaking changes
/bump-version major
```
