# Changelog

## 0.3.0

- Removed `/build` skill (moved to standalone usage)
- Removed `/configure` skill
- Removed `/document` skill
- Removed `/one-shot` skill
- Removed `/plan-build-validate` skill
- Removed `/sdlc-review` skill
- Removed `/git-branch`, `/git-commit`, `/git-pr` skills (moved to git plugin)
- Removed `/create-gh-issue`, `/read-gh-issue` skills (redundant with native `gh` CLI)
- Removed Configuration sections from skills (defaults inlined)

## 0.2.0

- Migrated all commands to skills format under `skills/` directory with `SKILL.md` files
- Updated all skills to return JSON output
- Renamed `/configure-interactive-sdlc` to `/configure`
- Consolidated `/plan-chore`, `/plan-bug`, `/plan-feature` into single `/sdlc-plan` skill with type argument
- Consolidated `/analyze-bug`, `/analyze-doc`, `/analyze-debt`, `/analyze-style`, `/analyze-security` into single `/analyze` skill with type argument
- **Breaking:** Commands directory structure replaced with skills directory structure
- **Breaking:** Planning skills now use `/sdlc-plan <type>` syntax
- **Breaking:** Analysis skills now use `/analyze <type>` syntax

## 0.1.2

- Added `--draft` flag to `/git-pr` command for creating draft PRs
- Added `--pr` flag to `/one-shot` workflow for creating draft PRs after completion
- Updated `/one-shot` to create branch using `/git-branch` before implementation
- Updated `/one-shot`, `/plan-build-validate`, `/build` to use `/git-commit` for commits
- Updated `/plan-build-validate` to use `/git-pr --draft` for PR creation
- Normalized all command prompts to follow template conventions

## 0.1.1

- Updated configuration path from `.claude/settings.json` to `.claude/configs/interactive-sdlc.json`

## 0.1.0

- Initial release of interactive-sdlc plugin
- Added planning commands: `/plan-chore`, `/plan-bug`, `/plan-feature`
- Added implementation command: `/build` with checkpoint support
- Added validation command: `/validate` with tests, code review, build verification, and plan compliance
- Added workflow commands: `/one-shot`, `/plan-build-validate`
- Added documentation command: `/document` with mermaid diagram support
- Added analysis commands: `/analyze-bug`, `/analyze-doc`, `/analyze-debt`, `/analyze-style`, `/analyze-security`
- Added git commands: `/git-branch`, `/git-commit`, `/git-pr`
- Added GitHub commands: `/create-gh-issue`, `/read-gh-issue`
- Added configuration command: `/configure-interactive-sdlc`
- Added plan templates for chore, bug, and feature types
- Added configuration system via `.claude/settings.json`
- Added context argument support for all commands to reduce interactive prompts
