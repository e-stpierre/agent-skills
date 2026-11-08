# Changelog

## 0.6.0

- Initial release of the `esp-skills` plugin, consolidating the code-review, git, github, helpers, interactive-sdlc, skill-builder, and style plugins
- **Breaking**: skill namespaces changed from `<plugin>:<skill>` to `esp-skills:esp-<skill>` (e.g., `/git:git-commit` -> `/esp-skills:esp-commit`); uninstall the old plugins and install `esp-skills@esp`
- **Breaking**: every skill is now prefixed with `esp-`; the git skills drop their `git-` prefix (`git-branch` -> `esp-branch`, `git-commit` -> `esp-commit`, `git-pr` -> `esp-pr`)
- **Removed**: `add-task` and `bump-version` skills (tasks and versioning plugins)
- Included skills: esp-analyze, esp-branch, esp-code-review, esp-commit, esp-create-skill, esp-fix-pr, esp-markdown, esp-pr, esp-qna, esp-rubberduck, esp-sdlc-plan
