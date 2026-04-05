# Changelog

## 0.4.1

- Added helpers plugin with `qna` and `rubberduck` skills
- Standardized CHANGELOG format across all plugins to flat bullet-point style
- Updated versioning plugin with two-level changelog documentation
- Updated release workflow to use actions/checkout@v5

## 0.4.0

- Add versioning plugin with `bump-version` skill

## 0.3.0

- Rename project from clauding to agent-skills
- Split interactive-sdlc plugin into focused plugins (git, github, style, skill-builder, tasks)
- Add github plugin (`fix-pr` skill), style plugin (`markdown` skill), skill-builder plugin (`create-skill` skill), tasks plugin (`add-task` skill)
- Remove obsolete skills (build, configure, create-gh-issue, document, one-shot, plan-build-validate, read-gh-issue, sdlc-review)

## 0.2.0

- Migrate commands to skills directory structure

## 0.1.2

- Normalize prompts and update templates

## 0.1.1

- Update configure command to use per-plugin configuration files

## 0.1.0

- Add Claude Code marketplace and interactive-sdlc plugin
