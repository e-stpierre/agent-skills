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
- **Breaking**: renamed `esp-code-review` to `esp-review` (`/esp-skills:esp-code-review` -> `/esp-skills:esp-review`). The output is now the `esp-reviewer` finding format (`#### F<n> - <severity> - <dimension> - <class>`) followed by a contract result block, instead of the `## Code review` emoji list
- `esp-review` reviews in a fresh-context `esp-reviewer` across configurable dimensions (correctness, security, plan conformance, tests, conventions, simplification, performance) with a find and a verify pass, classifies findings as A, B-Decide or B-Scope, and gains `--focus`, `--plan`, `--interactive`, `--run-dir` and `--config-snapshot`; untracked files and PR URLs are now reviewed too
- Added `scripts/review.mjs` to resolve review targets into diff files and parse reviews into findings (`review-<N>.json`) and a result block; `review` is now an active config key
- Added `esp-await-review` skill: waits in the background for bot reviewers (Claude, Codex, or any login) to review the head commit of a PR, with timeout, backoff and optional trigger comments, and ends with a contract result block
- Added `scripts/wait-for-review.mjs`, the token-free wait loop behind it (`--once` for a single check); `await-review` and `go.default_reviewers` are now active config keys
- **Breaking**: renamed `esp-fix-pr` to `esp-fix-review` (`/esp-skills:esp-fix-pr 42` -> `/esp-skills:esp-fix-review 42`). The PR argument is now optional (default: the PR of the current branch), fixes are committed as `fix(review): ...` and `fix(ci): ...` commits, and the output ends with a contract result block
- `esp-fix-review` classifies every comment with the decision policy, replies to rejected and deferred comments, filters by `--reviewers`, runs up to `--rounds` rounds with a re-review wait between them, never reprocesses a handled comment, logs every resolution in `decisions.jsonl`, returns deferred items as `discovered_items`, and gains `--internal` (apply `esp-review` findings without a PR), `--interactive`, `--run-dir` and `--config-snapshot`
- Added `scripts/fix-review.mjs` to fetch and filter review items, track rounds and handled IDs, record resolutions, post replies and resolve threads, and build the result block; `fix-review` and `commit.review_fixes` are now active config keys
- Added `esp-merge` skill: merges a PR only when `scripts/merge-ready.mjs` reports every condition met (no halt, checks green, threads resolved, not a draft, no changes requested, up to date with the base, branch protection satisfied), rebases and re-checks a branch that is behind, waits for pending checks in the background, never bypasses branch protection, and logs the method and reason as a decision
- Added `scripts/merge-ready.mjs` to check merge conditions, resolve the merge method from repository settings, rulesets and merge queues, and merge under the `AF_MERGE_LOCK` lock when a harness sets it; `merge` and `worktrees.cleanup` are now active config keys
- Added `esp-go-light` skill: takes a small task from request to merged PR in one session (context, branch, implement, gates, one commit, PR, bot review wait, review fixes, refreshed PR body, merge, summary), with no subagents and no plan file. It escalates to `esp-go` (`status: escalate`, exit 30) beyond `go-light.max_files_changed`, on a design decision, or after two gate failures, saving the work as a patch and a stash; `--stop-before-wait` ends once the PR is open
- Added `scripts/go-light.mjs` (phase state, file and gate limits, wall time budget, escalation hand-off, PR body, result block) and `scripts/lib/pr-body.mjs` (PR body from run artifacts); `go-light`, `go.halt_on`, `pr.body_from_run` and `pr.body_sections` are now active config keys
- Skill templates allow valued options (`[--name <value>]`) for harness and orchestration inputs such as `--run-dir <path>`

## 0.6.0

- Initial release of the `esp-skills` plugin, consolidating the code-review, git, github, helpers, interactive-sdlc, skill-builder, and style plugins
- **Breaking**: skill namespaces changed from `<plugin>:<skill>` to `esp-skills:esp-<skill>` (e.g., `/git:git-commit` -> `/esp-skills:esp-commit`); uninstall the old plugins and install `esp-skills@esp`
- **Breaking**: every skill is now prefixed with `esp-`; the git skills drop their `git-` prefix (`git-branch` -> `esp-branch`, `git-commit` -> `esp-commit`, `git-pr` -> `esp-pr`)
- **Removed**: `add-task` and `bump-version` skills (tasks and versioning plugins)
- Skills are grouped in category subfolders (`git`, `github`, `review`, `sdlc`, `helpers`, `style`, `authoring`) and registered explicitly in `.claude-plugin/plugin.json`
- Included skills: esp-analyze, esp-branch, esp-code-review, esp-commit, esp-create-skill, esp-fix-pr, esp-markdown, esp-pr, esp-qna, esp-rubberduck, esp-sdlc-plan
