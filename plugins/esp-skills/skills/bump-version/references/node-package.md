# Node Package Version Update Reference

## Overview

This reference covers version bumping for npm packages that use a `package.json` at the repository root and a single `CHANGELOG.md` at the root.

## Identifying the Latest Release

Read the current `version` field from `package.json`:

```bash
cat package.json | grep '"version"'
```

## Getting the Diff

Compare the current working tree against the latest released version using a git tag. npm packages typically tag releases as `vX.Y.Z` or `X.Y.Z`.

1. Check if a git tag exists for the current version:

   ```bash
   git tag -l "v$(node -p "require('./package.json').version")"
   ```

2. If a tag exists, diff against it:

   ```bash
   git diff v<current-version>...HEAD
   ```

3. If no tag exists, diff against the last commit that modified `package.json` version:

   ```bash
   git log -1 --format="%H" -- package.json
   ```

   Then diff from that commit:

   ```bash
   git diff <commit-hash>...HEAD
   ```

## Files to Update

### package.json

Update the `version` field to the new version:

```json
{
  "version": "X.Y.Z"
}
```

If a `package-lock.json` exists, run `npm install --package-lock-only` to sync the lock file version.

### CHANGELOG.md

Add a new entry at the top of the changelog (below the header). Follow the CHANGELOG format defined in the main SKILL.md.

The CHANGELOG is located at the repository root: `./CHANGELOG.md`

If no CHANGELOG.md exists, create one with the header:

```markdown
# Changelog

All notable changes to this project will be documented in this file.
```
