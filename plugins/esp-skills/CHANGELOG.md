# Changelog

## 0.6.0

- Initial release of the `esp-skills` plugin, consolidating the code-review, git, github, helpers, interactive-sdlc, skill-builder, style, tasks, and versioning plugins
- **Breaking**: skill namespaces changed from `<plugin>:<skill>` to `esp-skills:<skill>` (e.g., `/git:git-commit` -> `/esp-skills:git-commit`); uninstall the old plugins and install `esp-skills@esp`
- Included skills: add-task, analyze, bump-version, code-review, create-skill, fix-pr, git-branch, git-commit, git-pr, markdown, qna, rubberduck, sdlc-plan
