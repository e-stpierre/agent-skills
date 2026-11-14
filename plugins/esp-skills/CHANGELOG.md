# Changelog

## Unreleased

- Added the agentic-forge workflow pack in `af-workflows/`: `esp-go` (plan, approval, one ralph-loop iteration and one verified commit per milestone, internal review on Claude or Codex, PR, harness review and checks waits, merge), `esp-go-light` (inline `esp-ship` until the PR is open, then the harness waits and merge) and `esp-epic` (an epic file for the overseer backlog). Each declares `requires: { agentic-forge: ">=0.12", contract: 1 }`
- Re-synced `references/contract/v1/` with the contract agentic-forge publishes: `needs_input` gains optional `kind` (`question`, `permission`, `decision`) and `risk`, and an amendment delivered as an operator message has `plan_version: null`. `decision-policy.md` tells skills to set `kind` and `risk` on their requests

## 0.8.0

- **Migration from 0.7.0**: `esp-go`, `esp-go-light`, `esp-build` and `esp-await-review` are removed, with no aliases. Replace them in your prompts, scripts and workflows:
  - `/esp-skills:esp-go <task>` -> `/esp-skills:esp-ship <task>` (`--track orchestrated` to always plan and build milestones)
  - `/esp-skills:esp-go-light <task>` -> `/esp-skills:esp-ship --track inline <task>`
  - `/esp-skills:esp-build --run-dir <run>` -> `/esp-skills:esp-ship --run-dir <run>` with the plan in the run; `esp-build --milestone next` -> `esp-ship --milestone next --run-dir <run>`
  - `/esp-skills:esp-await-review` -> `/esp-skills:esp-fix-review --wait` (waits for the reviews and the CI checks, then fixes them); `--trigger` -> `fix-review.wait.auto_trigger`, `--timeout` stays
  - Resuming an escalated `esp-go-light` run with `esp-go --run-dir <run>` -> `esp-ship --resume --run-dir <run>`
  - Scripts: `go.mjs`, `go-light.mjs` and `build.mjs <cmd>` -> `ship.mjs` and `ship.mjs milestone <cmd>`; `ship.json` replaces `go.json` and `go-light.json`, and `state.json` keeps its layout. `pr-loop --after await` -> `--after wait`, and the wait step is `fix-review-wait`
- **Breaking config**: the `go`, `go-light`, `build` and `await-review` sections are removed, and a config file that still holds them fails validation. Move the keys:
  - `go.phases`, `go-light.phases` -> `ship.phases` (filtered per track; `await-review` is no longer a phase)
  - `go.internal_review_rounds`, `go.worktree`, `go.pr_draft_until_reviewed`, `go.halt_on` -> `ship.<same key>`
  - `go.budgets.*` -> `ship.budgets.orchestrated.*`, `go-light.budgets.max_wall_minutes` -> `ship.budgets.inline.max_wall_minutes`
  - `go-light.max_files_changed` -> `ship.inline.max_files_changed`, `go-light.escalate_to_go` -> `ship.inline.escalate`
  - `build.max_retries_per_milestone`, `build.commit_per_milestone`, `build.gates` -> `ship.<same key>`; `build.parallel` (`true`/`false`) -> `ship.parallel` (`on`/`off`, default `auto`)
  - `await-review.*` -> `fix-review.wait.*`, `go.default_reviewers` -> `fix-review.wait.default_reviewers`
- Added `esp-ship` skill: takes any task (a prompt, an issue, a plan, a task list or a design document) to a merged PR. Triage picks the plan source and the track; the inline track works in one session with one commit, the orchestrated track runs the milestone builders and verifiers from the main session; both share the PR, wait, fix-review and merge tail. An inline task that grows switches to the orchestrated track in place
- Added `ship.mjs triage`: detects the request kind, imports task lists, reuses plans, logs one decision per choice, and ends a fully checked task list `done` with no branch
- Added `--plan auto|skip|always` and `--review auto|internal|pr|both|none` (`ship.plan_mode`, `ship.review_mode`), and `ship.mjs review-gate`, which skips the internal review of a small, low-risk diff (`ship.auto.*`, `ship.review.always_paths`)
- Added `--branch` and the `workspace` command: an existing local or remote branch is reused, and a dirty working tree moves the task to a worktree (`ship.dirty_tree`)
- Added scoped gates (`ship.gates_scope`, `ship.gates.always`): builders and verifiers run the milestone's validation commands, and a `final-gates` phase runs the full gates once before the review and the push
- Added parallel milestone batches by default (`ship.parallel: auto`, `ship.max_parallel`), `plan.mjs batches`, and lint warnings for independent milestones that share files
- Added builder reuse (`ship.mjs milestone reuse` and `milestone agent`, `ship.reuse.*`): a builder continues with a related milestone while its estimated context allows
- Added run notes (`runs.mjs notes`): builders read and append short facts in `<run-dir>/notes.md`
- `esp-plan` gains `--import <path>` (task list or design document to plan, no exploration); `plan.mjs` gains `import`, `synthesize` and `tasks`
- `esp-fix-review` gains `--wait` and `--timeout`: `wait-for-review.mjs --checks` waits for the reviews and the CI checks of the head commit (`fix-review.wait.checks_grace_seconds`), and the CI fixes use the checks the wait reported. `merge-ready.mjs` and `fix-review.mjs` share `lib/checks.mjs`
- `esp-recap` reports esp-ship runs with their track (`esp-ship, inline`), and still reads `esp-go`, `esp-go-light` and `await-review` runs under their recorded names

## 0.7.0

- **Migration from 0.6.0**: three skills are renamed. Replace `/esp-skills:esp-sdlc-plan` with `/esp-skills:esp-plan`, `/esp-skills:esp-code-review` with `/esp-skills:esp-review`, and `/esp-skills:esp-fix-pr` with `/esp-skills:esp-fix-review` in your prompts, scripts and workflows. Plans now live in a run directory (`~/.esp-skills/runs/`) instead of `specs/`, reviews use the finding format, and fix commits are `fix(review): ...`; see the **Breaking** entries below
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
- Added `esp-go` skill: takes a feature from request to merged PR (plan, approve, branch, build one commit per milestone, internal review and fix rounds bounded by `go.internal_review_rounds`, PR, bot review wait, PR fix rounds, refreshed PR body, merge, summary). Each phase runs in its own subagent with its role model, and the orchestrator keeps only result blocks; `--resume` continues an interrupted run, `--worktree` builds in a task worktree, and runs escalated by `esp-go-light` are picked up in place
- Added `scripts/go.mjs` (phase dispatch, internal review and PR round loops, budgets, task worktree, escalation pickup, PR body, result block); every `go` key is now active
- `esp-pr` gains `--run-dir`: with `pr.body_from_run`, the body is built from the run artifacts (`runs.mjs pr-body`) and the PR URL is recorded in `run.json`
- `esp-fix-review` in internal mode keeps one state file per review round (`fix-review-<N>.json`) under a run directory, apart from the PR rounds
- Added `esp-recap` skill: recaps runs from every root in `recap.roots` (filters `--since`, `--until`, `--last`, `--repo`, `--status`, `--risk`), reports high-risk decisions, critical findings and stopped runs (`--risks`), and answers questions with sources in the order decisions, summaries, git log and blame, PR descriptions and comments; above `recap.fan_out_threshold` runs it digests them in parallel subagents
- Added `scripts/recap.mjs` (`collect`, `show`, `risks`, `sources`); `recap` is now an active config key
- **Breaking**: every skill takes arguments as named options with a short and a long name (`-t|--type <type>`), and flags gain short names; only trailing free text stays positional. For example `/esp-skills:esp-branch my-feature fix 12` -> `/esp-skills:esp-branch --slug my-feature --type fix --issue 12`, `/esp-skills:esp-fix-review 42` -> `/esp-skills:esp-fix-review --pr 42`, `/esp-skills:esp-analyze security` -> `/esp-skills:esp-analyze --type security`. `esp-create-skill` and the skill template define the convention, reserved short letters, and the plugin-wide letters (`-d` run dir, `-c` config snapshot, `-i` interactive, `-r` reviewers, `-p` PR or plan, `-u` resume)
- Skill prompts reviewed for clarity: tighter descriptions, sharper completion criteria, fewer restatements

## 0.6.0

- Initial release of the `esp-skills` plugin, consolidating the code-review, git, github, helpers, interactive-sdlc, skill-builder, and style plugins
- **Breaking**: skill namespaces changed from `<plugin>:<skill>` to `esp-skills:esp-<skill>` (e.g., `/git:git-commit` -> `/esp-skills:esp-commit`); uninstall the old plugins and install `esp-skills@esp`
- **Breaking**: every skill is now prefixed with `esp-`; the git skills drop their `git-` prefix (`git-branch` -> `esp-branch`, `git-commit` -> `esp-commit`, `git-pr` -> `esp-pr`)
- **Removed**: `add-task` and `bump-version` skills (tasks and versioning plugins)
- Skills are grouped in category subfolders (`git`, `github`, `review`, `sdlc`, `helpers`, `style`, `authoring`) and registered explicitly in `.claude-plugin/plugin.json`
- Included skills: esp-analyze, esp-branch, esp-code-review, esp-commit, esp-create-skill, esp-fix-pr, esp-markdown, esp-pr, esp-qna, esp-rubberduck, esp-sdlc-plan
