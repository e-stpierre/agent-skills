# Changelog

## Unreleased

- Added `esp-config` skill to initialize, show, get, set, unset, and validate configuration
- Added layered configuration (defaults, `~/.esp-skills/config.json`, `<repo>/.esp-skills/config.json`, `--config-snapshot`) resolved by `scripts/config.mjs`, with `references/config.schema.json` and `references/config-defaults.json`
- `esp-branch`, `esp-commit`, `esp-pr`, and `esp-analyze` read their settings from configuration; defaults keep the 0.6.0 behavior
- Added harness contract v1 (`references/contract/v1/`), a copy of the schemas agentic-forge publishes: JSON Schemas with valid and invalid fixtures for `run.json`, result blocks, `needs_input`, inbox messages, amendments, events, decisions, and `summary.md` frontmatter, plus `references/contract-notes.md`
- Added `scripts/runs.mjs` to create, update, validate, and index run directories, append decisions and events, write step result blocks, and manage operator messages and plan amendments; `runs.root` is now an active config key
- Added agents `esp-builder` (one milestone or review-fix set as one commit), `esp-reviewer` (read-only find and verify review), and `esp-verifier` (independent gate and acceptance check), each returning a contract result block
- Added shared references `decision-policy.md`, `summary-template.md`, and `model-selection.md`
- **Breaking**: renamed `esp-sdlc-plan` to `esp-plan` (`/esp-skills:esp-sdlc-plan` -> `/esp-skills:esp-plan`). Plans now use plan format 1 (`references/plan-format.md`), are written to a run directory instead of `specs/`, and are never committed; the `[--git]`, `[explore-count]` and `[path]` arguments are removed (use `plan.explore_agents` in the config)
- `esp-plan` gains `--type`, `--interactive`, `--run-dir`, `--config-snapshot` and `--amend` (writes `plan.v<N>.md`, keeps completed milestones, logs `amendments.jsonl` and `decisions.jsonl`), runs plan-lint, and ends with a contract result block
- Added `scripts/plan.mjs` to parse plans into JSON, lint them, and diff plan versions; `plan`, `defaults.interactive` and `defaults.models` are now active config keys
- Added `esp-build` skill: builds a plan with one `esp-builder` commit per milestone, verified by `esp-verifier`, with retries that amend the commit, `--milestone next` single-milestone mode, `--resume`, and `--parallel` worktrees for disjoint milestones
- Added `scripts/build.mjs` to manage `state.json` (milestone status, attempts, commits, frozen config), pick the next milestone, resolve builder and verifier models, and detect gate commands; `build` and `worktrees.root` are now active config keys
- Skill templates allow valued options (`[--name <value>]`) for harness and orchestration inputs such as `--run-dir <path>`

## 0.6.0

- Initial release of the `esp-skills` plugin, consolidating the code-review, git, github, helpers, interactive-sdlc, skill-builder, and style plugins
- **Breaking**: skill namespaces changed from `<plugin>:<skill>` to `esp-skills:esp-<skill>` (e.g., `/git:git-commit` -> `/esp-skills:esp-commit`); uninstall the old plugins and install `esp-skills@esp`
- **Breaking**: every skill is now prefixed with `esp-`; the git skills drop their `git-` prefix (`git-branch` -> `esp-branch`, `git-commit` -> `esp-commit`, `git-pr` -> `esp-pr`)
- **Removed**: `add-task` and `bump-version` skills (tasks and versioning plugins)
- Skills are grouped in category subfolders (`git`, `github`, `review`, `sdlc`, `helpers`, `style`, `authoring`) and registered explicitly in `.claude-plugin/plugin.json`
- Included skills: esp-analyze, esp-branch, esp-code-review, esp-commit, esp-create-skill, esp-fix-pr, esp-markdown, esp-pr, esp-qna, esp-rubberduck, esp-sdlc-plan
