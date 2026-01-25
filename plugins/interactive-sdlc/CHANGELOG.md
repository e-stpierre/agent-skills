# Changelog

All notable changes to the interactive-sdlc plugin will be documented in this file.

## [0.1.2] - 2026-01-24

### Changed

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
