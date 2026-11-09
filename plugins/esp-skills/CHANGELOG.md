# Changelog

## Unreleased

- Added `esp-config` skill to initialize, show, get, set, unset, and validate configuration
- Added layered configuration (defaults, `~/.esp-skills/config.json`, `<repo>/.esp-skills/config.json`, `--config-snapshot`) resolved by `scripts/config.mjs`, with `references/config.schema.json` and `references/config-defaults.json`
- `esp-branch`, `esp-commit`, `esp-pr`, and `esp-analyze` read their settings from configuration; defaults keep the 0.6.0 behavior
- Added a draft harness contract v1 (`references/contract/v1/`): JSON Schemas with valid and invalid fixtures for `run.json`, result blocks, `needs_input`, inbox messages, amendments, events, decisions, and `summary.md` frontmatter, plus `references/contract-notes.md`
- Added `scripts/runs.mjs` to create, update, validate, and index run directories, append decisions and events, write step result blocks, and manage operator messages and plan amendments; `runs.root` is now an active config key
- Added agents `esp-builder` (one milestone or review-fix set as one commit), `esp-reviewer` (read-only find and verify review), and `esp-verifier` (independent gate and acceptance check), each returning a contract result block
- Added shared references `decision-policy.md`, `summary-template.md`, and `model-selection.md`

## 0.6.0

- Initial release of the `esp-skills` plugin, consolidating the code-review, git, github, helpers, interactive-sdlc, skill-builder, and style plugins
- **Breaking**: skill namespaces changed from `<plugin>:<skill>` to `esp-skills:esp-<skill>` (e.g., `/git:git-commit` -> `/esp-skills:esp-commit`); uninstall the old plugins and install `esp-skills@esp`
- **Breaking**: every skill is now prefixed with `esp-`; the git skills drop their `git-` prefix (`git-branch` -> `esp-branch`, `git-commit` -> `esp-commit`, `git-pr` -> `esp-pr`)
- **Removed**: `add-task` and `bump-version` skills (tasks and versioning plugins)
- Skills are grouped in category subfolders (`git`, `github`, `review`, `sdlc`, `helpers`, `style`, `authoring`) and registered explicitly in `.claude-plugin/plugin.json`
- Included skills: esp-analyze, esp-branch, esp-code-review, esp-commit, esp-create-skill, esp-fix-pr, esp-markdown, esp-pr, esp-qna, esp-rubberduck, esp-sdlc-plan
