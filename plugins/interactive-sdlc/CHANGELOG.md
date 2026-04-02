# Changelog

All notable changes to the interactive-sdlc plugin will be documented in this file.

## [0.3.0] - 2026-04-01

### Removed

- Removed `/build` skill (moved to standalone usage)
- Removed `/configure` skill
- Removed `/document` skill
- Removed `/one-shot` skill
- Removed `/plan-build-validate` skill
- Removed `/sdlc-review` skill
- Removed `/git-branch`, `/git-commit`, `/git-pr` skills (moved to git plugin)
- Removed `/create-gh-issue`, `/read-gh-issue` skills (redundant with native `gh` CLI)
- Removed Configuration sections from skills (defaults inlined)

## [0.2.0] - 2026-01-27

### Changed

- Migrated all commands to skills format
- Commands now located in `skills/` directory with `SKILL.md` files
- Updated all skills to return JSON output
- Renamed `/configure-interactive-sdlc` to `/configure`
- Consolidated `/plan-chore`, `/plan-bug`, `/plan-feature` into single `/sdlc-plan` skill with type argument
- Consolidated `/analyze-bug`, `/analyze-doc`, `/analyze-debt`, `/analyze-style`, `/analyze-security` into single `/analyze` skill with type argument

### Breaking Changes

- Commands directory structure replaced with skills directory structure
- All skills must now be invoked using the skill invocation format
- Planning skills now use `/sdlc-plan <type>` syntax (e.g., `/sdlc-plan feature`, `/sdlc-plan bug`, `/sdlc-plan chore`)
- Analysis skills now use `/analyze <type>` syntax (e.g., `/analyze bug`, `/analyze security`)

## [0.1.2] - 2026-01-24

### Added

- Add `--draft` flag to `/git-pr` command for creating draft PRs
- Add `--pr` flag to `/one-shot` workflow for creating draft PRs after completion

### Changed

- Update `/one-shot` to create branch using `/git-branch` before implementation
- Update `/one-shot` to use `/git-commit` for committing changes
- Update `/plan-build-validate` to create branch using `/git-branch` before build
- Update `/plan-build-validate` to commit plan file using `/git-commit` after branch creation
- Update `/plan-build-validate` to use `/git-pr --draft` for PR creation
- Update `/build` to use `/git-commit` for commits at logical checkpoints
- Normalize all command prompts to follow template conventions
- Update README documentation for clarity

## [0.1.1] - 2026-01-23

### Changed

- Update configuration path from `.claude/settings.json` to `.claude/configs/interactive-sdlc.json`

## [0.1.0] - 2025-12-21

### Added

- Initial release of interactive-sdlc plugin
- Planning commands: `/plan-chore`, `/plan-bug`, `/plan-feature`
- Implementation command: `/build` with checkpoint support
- Validation command: `/validate` with tests, code review, build verification, and plan compliance
- Workflow commands: `/one-shot`, `/plan-build-validate`
- Documentation command: `/document` with mermaid diagram support
- Analysis commands: `/analyze-bug`, `/analyze-doc`, `/analyze-debt`, `/analyze-style`, `/analyze-security`
- Git commands: `/git-branch`, `/git-commit`, `/git-pr`
- GitHub commands: `/create-gh-issue`, `/read-gh-issue`
- Configuration command: `/configure-interactive-sdlc`
- Plan templates for chore, bug, and feature types
- Configuration system via `.claude/settings.json`
- Context argument support for all commands to reduce interactive prompts
