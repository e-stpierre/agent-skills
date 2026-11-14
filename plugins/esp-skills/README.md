# ESP Skills

## Overview

A single plugin bundling every skill in this repository: standardized git workflows, GitHub PR maintenance, high-signal code review, interactive SDLC planning and analysis, lightweight helpers, markdown style enforcement, and skill authoring. Skills are human-in-the-loop by default: they infer what they can from context and ask clarifying questions only when needed. Skills marked **Beta** are usable but may change.

Every skill is invoked as `/esp-skills:<skill>`. Unqualified names (`/esp-commit`, `/esp-qna`) also work as long as no other installed plugin provides a skill with the same name.

Arguments work like a standard CLI: discrete values are named options with a short and a long name (`-t|--type <type>`), and only trailing free text is positional (see [Complete Examples](#complete-examples)).

- `/esp-skills:esp-branch --slug add-oauth --issue 123` - Create a branch with standardized naming
- `/esp-skills:esp-commit` - Commit changes with a structured message
- `/esp-skills:esp-pr` - Create a pull request with a contextual description
- `/esp-skills:esp-fix-review --wait --reviewers codex --pr 42` - Wait in the background until Codex has reviewed the head commit of PR 42 and its CI checks have finished, then fix, reply to, or defer the comments and the failing checks
- `/esp-skills:esp-fix-review --internal --run-dir <run>` - Apply the findings of the last `esp-review` of a run, without a PR
- `/esp-skills:esp-merge --pr 42` - Merge PR 42 once its checks, threads, reviews and branch protection allow it, with the method the repo allows
- `/esp-skills:esp-review --target "PR 123"` - Review a pull request across correctness, security, tests and conventions, with classified findings
- `/esp-skills:esp-plan --type feature Add OAuth login` - Plan a feature as parseable milestones in a run directory
- `/esp-skills:esp-ship Fix the off-by-one in the pager` - Ship a small prompt to a merged PR in one session (the inline track), moving to milestones when it is not small
- `/esp-skills:esp-ship https://github.com/o/r/issues/31` - Ship an issue: triage picks the inline track or a generated plan from its size
- `/esp-skills:esp-ship ~/.esp-skills/runs/2026-11-10-add-oauth-login/plan.md` - Ship a plan: one verified commit per milestone, internal review, bot review and CI fixes, merge
- `/esp-skills:esp-ship docs/backlog.md` - Ship the unchecked packages of a task list (checkbox list plus one heading per package), imported as a plan and built in parallel batches where their files do not overlap
- `/esp-skills:esp-recap --last 7d` - Recap the runs of the last week; `--risks` lists high-risk decisions and critical findings, and a question gets an answer with sources
- `/esp-skills:esp-analyze --type security` - Analyze the codebase for security issues
- `/esp-skills:esp-qna How does OAuth 2.0 work?` - Get a concise answer without code changes
- `/esp-skills:esp-config set --key pr.draft true` - Change a configuration default
- `af run esp-go --var "task=Add OAuth login"` - Run the same pipeline under agentic-forge, one steerable step at a time (see [Running Under agentic-forge](#running-under-agentic-forge))

## Agents

Subagents spawned by the workflow skills. Each returns a contract result block and keeps details in the run dir. Spawn sites pass the model and effort of the role from the config (see `references/model-selection.md`); the frontmatter model is only a fallback.

| Agent                     | Description                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `esp-skills:esp-builder`  | Implements one milestone or one set of review fixes as exactly one commit           |
| `esp-skills:esp-reviewer` | Read-only, fresh-context review with a find and verify pass and classified findings |
| `esp-skills:esp-verifier` | Re-runs gates and checks acceptance criteria without changing code                  |

## Skills

### Git

| Skill                    | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `/esp-skills:esp-branch` | Create branches with standardized naming conventions |
| `/esp-skills:esp-commit` | Commit changes with structured messages              |
| `/esp-skills:esp-pr`     | Create pull requests with contextual descriptions    |

### Config

| Skill                    | Description                                                           |
| ------------------------ | --------------------------------------------------------------------- |
| `/esp-skills:esp-config` | Initialize, show, get, set, and validate the esp-skills configuration |

### GitHub

| Skill                        | Description                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/esp-skills:esp-fix-review` | Wait for the bot reviews and CI checks, then fix, reply to, or defer the comments and failing checks over bounded rounds, or apply `esp-review` findings |
| `/esp-skills:esp-merge`      | Merge a PR under objective conditions, with the method the repository allows, rebasing when behind                                                       |

### Code Review

| Skill                    | Description                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `/esp-skills:esp-review` | Review a diff, branch or PR across dimensions; findings classified A, B-Decide, B-Scope |

### SDLC

| Skill                     | Description                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| `/esp-skills:esp-plan`    | **Beta** - Create or amend a machine-readable implementation plan    |
| `/esp-skills:esp-ship`    | **Beta** - Any task to merged PR: inline, or as verified milestones  |
| `/esp-skills:esp-recap`   | **Beta** - Recap runs, report their risks, or answer with sources    |
| `/esp-skills:esp-analyze` | **Beta** - Analyze codebase for bugs, debt, docs, security, or style |

### Helpers

| Skill                        | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| `/esp-skills:esp-qna`        | Answer user questions with clear, concise responses |
| `/esp-skills:esp-rubberduck` | Rubber duck debugging and idea clarification        |

### Style

| Skill                      | Description                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `/esp-skills:esp-markdown` | **Beta** - Enforce markdown formatting conventions and non-auto-fixable lint rules |

### Skill Building

| Skill                          | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `/esp-skills:esp-create-skill` | **Beta** - Create a new Claude Code skill following best practices |

## Configuration

Configuration is optional. Every skill works with the built-in defaults, and `/esp-skills:esp-config` creates and edits config files. Skills resolve their settings through `scripts/config.mjs`, which merges these layers (later wins):

1. Built-in defaults: `references/config-defaults.json`
2. User config: `~/.esp-skills/config.json` (`ESP_SKILLS_HOME` overrides `~/.esp-skills`)
3. Project config: `<repo>/.esp-skills/config.json`
4. Config snapshot (`--config-snapshot <path>`): replaces the user and project layers for one run
5. Skill arguments

Objects merge key by key; arrays and scalars replace. Invalid config fails with the file, key path and expected type. Files are validated against `references/config.schema.json`; add its URL as `$schema` for editor completion:

```json
{
  "$schema": "https://raw.githubusercontent.com/e-stpierre/skills/main/plugins/esp-skills/references/config.schema.json",
  "version": 1,
  "pr": { "draft": true },
  "commit": { "style": "conventional" }
}
```

Keys read by the current skills:

| Key                                          | Default                                                         | Read by                                   | Effect                                                                              |
| -------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `defaults.language`                          | `en-US`                                                         | `esp-commit`, `esp-pr`                    | Language of generated messages                                                      |
| `branch.pattern`                             | `{category}/{issue}_{name}`                                     | `esp-branch`                              | Branch name when an issue ID is known                                               |
| `branch.pattern_without_issue`               | `{category}/{name}`                                             | `esp-branch`                              | Branch name when no issue ID is known                                               |
| `branch.default_category`                    | `feature`                                                       | `esp-branch`                              | Category when none is given or inferred                                             |
| `branch.categories`                          | `feature, fix, chore, doc, refactor, poc`                       | `esp-branch`                              | Suggested categories (others still work)                                            |
| `commit.style`                               | `plain`                                                         | `esp-commit`                              | `plain` imperative title or `conventional` commits                                  |
| `commit.co_author`                           | `true`                                                          | `esp-commit`                              | Add the `Co-Authored-By` trailer                                                    |
| `commit.plan_step_prefix`                    | `true`                                                          | `esp-commit`                              | Prefix titles with `[Task N]` when following a plan                                 |
| `pr.base`                                    | `null`                                                          | `esp-pr`                                  | Base branch, `null` uses the repository default branch                              |
| `pr.draft`                                   | `false`                                                         | `esp-pr`                                  | Open PRs as drafts                                                                  |
| `pr.attribution`                             | `true`                                                          | `esp-pr`                                  | Append the AI attribution line                                                      |
| `analyze.output_dir`                         | `analysis`                                                      | `esp-analyze`                             | Directory for analysis reports                                                      |
| `plan.default_type`                          | `auto`                                                          | `esp-plan`                                | Plan type when `--type` is not given                                                |
| `plan.explore_agents`                        | `feature: 3, bug: 2, chore: 2`                                  | `esp-plan`                                | Explore subagents per plan type                                                     |
| `defaults.interactive`                       | `off`                                                           | `esp-plan`, `esp-review`, `esp-ship`      | When skills stop to ask (`off`, `plan`, `all`)                                      |
| `defaults.models`                            | see `references/model-selection.md`                             | `esp-plan`, `esp-review`, `esp-ship`      | Model and effort per subagent role                                                  |
| `worktrees.root`                             | `~/.esp-skills/worktrees`                                       | `esp-ship`                                | Where task and parallel milestone worktrees are created                             |
| `review.dimensions`                          | `correctness, security, conventions, plan-conformance`          | `esp-review`                              | Dimensions checked when `--focus` names none                                        |
| `review.min_severity`                        | `medium`                                                        | `esp-review`                              | Findings below it are dropped                                                       |
| `review.verify_findings`                     | `true`                                                          | `esp-review`                              | Run the verify pass that rejects false positives                                    |
| `fix-review.wait.reviewers`                  | `claude`, `codex` (`@codex review` trigger)                     | `esp-fix-review`, `esp-ship`              | Reviewer names, GitHub logins and trigger comments                                  |
| `fix-review.wait.default_reviewers`          | `["claude"]`                                                    | `esp-fix-review`, `esp-ship`              | Reviewers waited for when `--reviewers` is not given                                |
| `fix-review.wait.timeout_minutes`            | `30`                                                            | `esp-fix-review`, `esp-ship`              | Time before the wait gives up                                                       |
| `fix-review.wait.poll_seconds`               | `60`                                                            | `esp-fix-review`, `esp-ship`              | First poll interval, backing off to 5x                                              |
| `fix-review.wait.auto_trigger`               | `false`                                                         | `esp-fix-review`, `esp-ship`              | Post the reviewers' trigger comments after a push                                   |
| `fix-review.wait.checks_grace_seconds`       | `120`                                                           | `esp-fix-review`, `esp-ship`              | An empty check list counts as pending this long after the head commit               |
| `fix-review.max_rounds`                      | `3`                                                             | `esp-fix-review`, `esp-ship`              | Fix rounds when `--rounds` is not given                                             |
| `fix-review.fix_ci`                          | `true`                                                          | `esp-fix-review`                          | Diagnose and fix failing CI checks                                                  |
| `fix-review.reply_to_rejected`               | `true`                                                          | `esp-fix-review`                          | Reply with the reason to rejected comments                                          |
| `fix-review.deferred_items`                  | `follow-up`                                                     | `esp-fix-review`                          | `follow-up` (reply, resolve, discovered item) or `block`                            |
| `commit.review_fixes`                        | `separate`                                                      | `esp-fix-review`                          | `fix(review)` commits, or `fixup!` commits                                          |
| `merge.enabled`                              | `true`                                                          | `esp-merge`                               | `false` leaves the PR open                                                          |
| `merge.method`                               | `repo`                                                          | `esp-merge`                               | `repo` resolves it from the repository, else forced                                 |
| `merge.preference`                           | `squash, rebase, merge`                                         | `esp-merge`                               | Order when the repository allows several methods                                    |
| `merge.delete_branch`                        | `true`                                                          | `esp-merge`                               | Delete the remote head branch after the merge                                       |
| `merge.require_resolved_threads`             | `true`                                                          | `esp-merge`                               | Unresolved review threads block the merge                                           |
| `merge.require_green_checks`                 | `true`                                                          | `esp-merge`                               | Every check must pass (`false`: required checks only)                               |
| `merge.use_auto_merge`                       | `false`                                                         | `esp-merge`                               | Enable auto-merge on pending checks instead of waiting                              |
| `merge.checks_timeout_minutes`               | `30`                                                            | `esp-merge`                               | Wait for pending checks and for a busy merge lock                                   |
| `worktrees.cleanup`                          | `on-merge`                                                      | `esp-merge`                               | Remove the task worktree after the merge (`never` keeps it)                         |
| `ship.phases`                                | every phase of the track                                        | `esp-ship`                                | Phases to run, filtered per track (`implement` or `build` is required)              |
| `ship.plan_mode`                             | `auto`                                                          | `esp-ship`                                | `--plan` default: `auto`, `skip` (no planning model) or `always`                    |
| `ship.review_mode`                           | `auto`                                                          | `esp-ship`                                | `--review` default: `auto`, `internal`, `pr`, `both` or `none`                      |
| `ship.auto.review_max_files`                 | `3`                                                             | `esp-ship`                                | Review gate: at most this many changed files may skip the internal review           |
| `ship.auto.review_max_lines`                 | `150`                                                           | `esp-ship`                                | Review gate: at most this many changed lines may skip the internal review           |
| `ship.review.always_paths`                   | auth, security, migrations, CI config globs                     | `esp-ship`                                | A changed path matching one always runs the internal review                         |
| `ship.internal_review_rounds`                | `2`                                                             | `esp-ship`                                | Review and fix rounds before the PR (`0` is like `--review pr`)                     |
| `ship.worktree`                              | `false`                                                         | `esp-ship`                                | Work in a task worktree under `worktrees.root`                                      |
| `ship.dirty_tree`                            | `worktree`                                                      | `esp-ship`                                | A dirty working tree moves the task to a worktree (`fail` stops)                    |
| `ship.pr_draft_until_reviewed`               | `true`                                                          | `esp-ship`                                | Open the PR as a draft, mark it ready once the body is in place                     |
| `ship.inline.max_files_changed`              | `10`                                                            | `esp-ship`                                | More changed files moves an inline task to the orchestrated track                   |
| `ship.inline.escalate`                       | `true`                                                          | `esp-ship`                                | `false`: continue over the file limit, halt on gates                                |
| `ship.budgets.inline.max_wall_minutes`       | `60`                                                            | `esp-ship`                                | Inline wall time budget, checked at each phase boundary                             |
| `ship.budgets.orchestrated.max_wall_minutes` | `240`                                                           | `esp-ship`                                | Orchestrated wall time budget, checked at each phase boundary                       |
| `ship.budgets.orchestrated.max_milestones`   | `12`                                                            | `esp-ship`                                | A larger plan halts with `budget`                                                   |
| `ship.halt_on`                               | all five stop conditions                                        | `esp-ship`, `esp-fix-review`, `esp-merge` | Stop conditions honored (see `decision-policy.md`)                                  |
| `ship.max_retries_per_milestone`             | `2`                                                             | `esp-ship`                                | Builder retries before the build halts                                              |
| `ship.parallel`                              | `auto`                                                          | `esp-ship`                                | Parallel milestone batches: `auto` (when the plan has one), `on` or `off`           |
| `ship.max_parallel`                          | `3`                                                             | `esp-ship`                                | Most milestones built at the same time                                              |
| `ship.commit_per_milestone`                  | `true`                                                          | `esp-ship`                                | `false` squashes milestone commits at the end                                       |
| `ship.gates`                                 | all `null` (auto-detect), `always: []`                          | `esp-ship`, `esp-merge`                   | Gate commands: `test`, `lint`, `typecheck`, `build`; `always` runs in every scope   |
| `ship.gates_scope`                           | `milestone`                                                     | `esp-ship`                                | Builders and verifiers run the milestone's validation commands (`full`: all gates)  |
| `ship.reuse.limit_tokens`                    | `250000`                                                        | `esp-ship`                                | Context budget of a builder continued with the next milestone                       |
| `ship.reuse.cost`                            | `low: 40000, medium: 70000, high: 120000`                       | `esp-ship`                                | Estimated context per milestone complexity, for builder reuse                       |
| `pr.body_from_run`                           | `true`                                                          | `esp-ship`, `esp-pr`                      | Build the PR body from the run artifacts                                            |
| `pr.body_sections`                           | `summary, milestones, decisions, review-resolution, follow-ups` | `esp-ship`, `esp-pr`                      | Sections of that body, in order                                                     |
| `recap.roots`                                | `["~/.esp-skills/runs"]`                                        | `esp-recap`                               | Runs roots read by the recap, besides `runs.root` (add the agentic-forge runs root) |
| `recap.default_range_days`                   | `7`                                                             | `esp-recap`                               | Days covered when no date option is given                                           |
| `recap.fan_out_threshold`                    | `5`                                                             | `esp-recap`                               | Above this many runs, digest them in parallel subagents                             |
| `runs.root`                                  | `~/.esp-skills/runs`                                            | `scripts/runs.mjs`                        | Where standalone run directories are created                                        |

Reserved keys are accepted and validated, but belong to skills that are not shipped yet. Their defaults are in `references/config-defaults.json`:

| Key                   | Planned use                |
| --------------------- | -------------------------- |
| `runs.retention_days` | Days to keep finished runs |

## Architecture

The SDLC skills (`esp-plan`, `esp-analyze`) accept an optional `[context]` argument as the last parameter. Providing context upfront replaces questions that would otherwise be asked interactively.

```bash
# With context - minimal prompts
/esp-skills:esp-plan --type bug Login fails on Safari when using OAuth.

# Without context - interactive prompts
/esp-skills:esp-plan --interactive plan --type bug
```

The `esp-review` skill produces markdown and a result block and performs no write-side effects on the repository. Routing the review (stdout, PR comment, file, CI annotation) is the caller's responsibility.

### Plans

`esp-plan` writes plans in plan format 1 (`references/plan-format.md`): frontmatter, fixed sections, and milestones with an ID, goal, complexity, dependencies, files, tasks, acceptance criteria and validation commands. Each milestone is one commit. `scripts/plan.mjs` parses a plan into JSON, lints it, and checks an amendment against the previous version:

```bash
node scripts/plan.mjs parse ~/.esp-skills/runs/2026-11-10-add-oauth-login/plan.md
node scripts/plan.mjs lint ~/.esp-skills/runs/2026-11-10-add-oauth-login/plan.md
node scripts/plan.mjs diff plan.md plan.v2.md --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
node scripts/plan.mjs batches ~/.esp-skills/runs/2026-11-10-add-oauth-login/plan.md
node scripts/plan.mjs import docs/backlog.md --run-dir ~/.esp-skills/runs/2026-11-10-backlog
```

- Plans live in the run directory, never in the repository, and are never edited once written
- An amendment writes `plan.v<N>.md`, keeps completed milestones unchanged, and is logged in `amendments.jsonl` and `decisions.jsonl`
- Plans never name models: milestone `complexity` selects the builder model from the config
- `batches` lists the dependency waves split into batches of milestones with disjoint files, and lint warns when two independent milestones share files
- `import` converts a task list into a plan with one milestone per unchecked package, and `synthesize` writes a one-milestone plan with no model

### Shipping

`esp-ship` takes any task to a merged PR: `preflight -> triage -> [plan] -> branch -> implement (inline) or build (milestones) -> final gates -> [internal review <-> fix] -> PR -> [wait (reviews + checks) <-> fix-review] -> refresh PR body -> merge -> summary`. `scripts/ship.mjs` keeps the state (`ship.json`) and decides what runs next, with which model, and when the task stops:

```bash
node scripts/ship.mjs triage --request docs/backlog.md
node scripts/ship.mjs next --run-dir <run>
node scripts/ship.mjs review-gate --run-dir <run>
node scripts/ship.mjs pr-loop --run-dir <run> --after fix
node scripts/ship.mjs pr-body --run-dir <run> --out <run>/pr-body.md
```

- **Triage**: detects the request (a plan file, a task list, a design document, a prompt or an issue) and picks the plan source (`reuse`, `import`, `generate`, `synthesize`, or none) and the track. A task list whose packages are all checked ends `done` with no branch. Each choice is a decision in `decisions.jsonl`
- **Inline track**: one session, no subagents, one commit. More files than `ship.inline.max_files_changed`, a design decision or a second gate failure moves the task to the orchestrated track in place (`switch-track`). With a caller-owned `--run-dir`, it ends `escalate` (exit 30) with the work saved as `escalation.patch` and stashed, and `esp-ship --resume --run-dir <run>` takes it over
- **Orchestrated track**: a plan file in the run, then the milestone loop (see Milestones), the full gates once, and the internal review in a fresh `esp-reviewer`. `--review auto` decides the internal review from the real diff (`review-gate`): small, low-risk changes outside `ship.review.always_paths` skip it
- **Workspace**: an existing branch is used as is, `--branch` checks out or creates a named one, and a dirty working tree moves the task to a worktree under `worktrees.root`, leaving the changes untouched
- **Tail**: both tracks open the PR, wait for the bot reviews and the CI checks of the head commit in a background script, fix both with `esp-fix-review` rounds, refresh the PR body from the run artifacts and merge with `esp-merge`. Halt conditions (`ship.halt_on`) stop the task and write the summary; a halted task is never merged
- `--resume` continues an interrupted run from `ship.json`, and `--stop-before-wait` ends once the PR is open, so a harness can wait for the reviews without a session

### Milestones

On the orchestrated track, the main session runs the plan milestone by milestone: an `esp-builder` subagent implements the milestone and commits, then an `esp-verifier` subagent re-runs the milestone's checks and the acceptance criteria. A failed verification retries the builder, which amends the milestone commit; exhausted retries halt the build. `ship.mjs milestone` keeps the loop state in `<run-dir>/state.json`:

```bash
node scripts/ship.mjs milestone init --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
node scripts/ship.mjs milestone next --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
node scripts/ship.mjs milestone gates --milestone M2 --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
node scripts/ship.mjs milestone reuse M3 --agent-id <id> --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
```

- **Parallel batches**: `plan.mjs batches` groups milestones whose dependencies are done and whose files do not overlap; with `ship.parallel: auto`, a batch of two or more is built in worktrees at once (up to `ship.max_parallel`), and the verified commits are cherry-picked in plan order
- **Scoped gates**: builders and verifiers run the milestone's validation commands plus `ship.gates.always`; the full gates run once after the build, with one fixer round before the task halts
- **Builder reuse**: a builder whose milestone the next one depends on, or shares files with, continues with it while the same model and effort apply and its estimated context stays within `ship.reuse.limit_tokens`. Verifiers are always fresh
- **Run notes**: builders read `<run-dir>/notes.md` before they start and append short facts for later milestones (`runs.mjs notes`)
- `--milestone next` runs one milestone per invocation, for loop-driven harness steps, and an amended plan (`esp-plan --amend`) is picked up on the next call, with done milestones kept

### Reviews

`esp-review` reviews a diff in a fresh-context `esp-reviewer` (or inline on a runtime without subagents) across the dimensions `correctness`, `security`, `plan-conformance`, `tests`, `conventions`, `simplification` and `performance`. A find pass collects candidates and a verify pass tries to prove each one wrong; survivors get a severity and a class from the decision policy (A, B-Decide, B-Scope) with a fix. `scripts/review.mjs` resolves the target into a diff file and parses the review into findings and a result block:

```bash
node scripts/review.mjs target main --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
node scripts/review.mjs parse review-1.md --min-severity medium --md-out review-1.md --out review-1.json
```

- Findings below `review.min_severity` are dropped, and the counts by class and severity go to the result block
- `review-<N>.json` (`review_format: 1`) is the machine-readable list a fixer consumes

### Waiting for Reviews and Checks

`esp-fix-review --wait` and the `esp-ship` tail wait without spending tokens: they start `scripts/wait-for-review.mjs` in the background and resume when the script exits. Each poll reads the pull request, its reviews, its comments and, with `--checks`, its CI checks through `gh`. A reviewer is done when it has reviewed the current head commit: a review on the head SHA, a completed review-state comment for the head SHA (Codex posts only a summary comment when it has no findings), or a non-placeholder comment after the head commit. The wait ends when every reviewer is done and no check of the head commit is pending; a failing check never ends it early, so one round fixes both. An empty check list counts as pending for `fix-review.wait.checks_grace_seconds` after the head commit. A push during the wait restarts it on the new head. The interval starts at `poll_seconds` and grows 1.5x per unchanged poll, up to 5x.

```bash
node scripts/wait-for-review.mjs 42 --reviewers codex,claude --checks --timeout-minutes 30 --trigger
node scripts/wait-for-review.mjs 42 --reviewers codex --once
```

- Exit codes: 0 done, 10 awaiting-human (timeout, with a `needs_input` request to wait again or skip), 1 failed (closed pull request or repeated `gh` errors), 2 usage error
- Verified logins: Codex reviews as `chatgpt-codex-connector[bot]` and starts on its own when a PR opens or leaves draft; `@codex review` asks for a new review after a push. The Claude GitHub Action reviews through an issue comment by `claude[bot]`, not a PR review

### Fixing Reviews

`esp-fix-review` resolves review items in rounds: fetch -> classify (A-Fix, B-Decide, B-Scope, Reject) -> fix and commit -> push -> reply and resolve -> wait for the re-review. `scripts/fix-review.mjs` keeps the state (`<run-dir>/fix-review.json`): handled item IDs, so a later round or a rerun never reprocesses a comment, the round count bounded by `--rounds`, and the GitHub replies still owed. The model classifies and fixes; the script posts the replies, resolves the threads and builds the result block:

```bash
node scripts/fix-review.mjs round --run-dir <run>
node scripts/fix-review.mjs fetch 42 --reviewers codex --run-dir <run>
node scripts/fix-review.mjs record --run-dir <run> --json '{"items":["inline:101"],"resolution":"fixed","class":"A-Fix","decision":"Fixed the bound","rationale":"skipped the last element","commit":"3f2a1c0"}'
node scripts/fix-review.mjs respond --run-dir <run>
node scripts/fix-review.mjs result --run-dir <run>
```

- `internal [review-<N>.json]` loads `esp-review` findings instead of PR comments, for the internal review loop
- Every resolution is a decision in `decisions.jsonl`; deferred items become `discovered_items` (no GitHub issues are opened)
- Rounds exhausted with items left halt the task when `budget` is in `ship.halt_on`, else they become a follow-up item

### Merging

`esp-merge` never decides by itself that a PR may merge: `scripts/merge-ready.mjs` checks the conditions (no halt in the run, checks green, threads resolved, not a draft, no changes requested, up to date with the base, branch protection satisfied) and resolves the method. The skill rebases a branch that is behind (gates re-run, `--force-with-lease` on the PR branch only), waits for pending checks in the background, and halts on a conflict it cannot resolve:

```bash
node scripts/merge-ready.mjs check 42
node scripts/merge-ready.mjs check 42 --wait
node scripts/merge-ready.mjs merge 42 --run-dir <run>
```

- Method (`merge.method: repo`): merge queue -> enqueue; one allowed method -> it; several -> the first allowed in `merge.preference`, never `merge` under linear history; an explicit method errors when not allowed. The method and its reason are logged as a decision
- Unmet branch protection ends `awaiting-human` and is never bypassed (no `--admin`). A Halt decision blocks the merge until an operator decision references it
- With `AF_MERGE_LOCK` set (a harness serializing merges), `merge` holds that lock file from its final check to the cleanup; standalone runs merge directly

### Run Directories

Workflow skills record their work in a run directory that follows harness contract v1, owned and published by agentic-forge: `run.json`, step result blocks, `decisions.jsonl`, `events.jsonl`, operator messages and plan amendments. Standalone runs go to `<runs.root>/<YYYY-MM-DD>-<slug>`; a harness or parent run passes `--run-dir <path>` instead. Skills never write these files by hand: `scripts/runs.mjs` creates, updates, validates and indexes them. The schemas and fixtures are in `references/contract/v1/`, and `references/contract-notes.md` maps each contract requirement to the command that meets it.

```bash
node scripts/runs.mjs create fix-login-timeout --workflow esp-ship
node scripts/runs.mjs index --last 7d --status merged,done --risk medium
node scripts/runs.mjs validate ~/.esp-skills/runs/2026-11-10-fix-login-timeout/events.jsonl
```

### Recaps

`esp-recap` reads the run directories of every root in `recap.roots` and `runs.root`, standalone and harness runs alike, and cites a source for each statement. `scripts/recap.mjs` selects the runs through the `runs.mjs index` filters and returns compact JSON: `collect` (one digest per run, and fan-out batches above `recap.fan_out_threshold`), `show` (one run in full), `risks` (high-risk decisions, critical findings, stopped runs) and `sources` (Q&A candidates in the order decisions -> summaries -> git log and blame -> PR descriptions and comments):

```bash
node scripts/recap.mjs collect --last 7d --repo api
node scripts/recap.mjs risks --since 2026-11-01 --min-risk medium
node scripts/recap.mjs sources --question "Why do refresh tokens rotate?"
```

### Running Under agentic-forge

The plugin ships an agentic-forge workflow pack in `af-workflows/` (not `workflows/`, which Claude Code uses for Workflow tool scripts). agentic-forge discovers it from the installed plugin, or from `skill_packs.paths` in its config, and `af workflows` lists it under `Skill pack: esp-skills`. Each workflow declares `requires: { agentic-forge: ">=0.12", contract: 1 }`; `af doctor` checks it, and `af run --ignore-requires` runs on an older build.

| Workflow       | Flow                                                                                                                                         | Variables                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `esp-go`       | plan -> approve -> branch -> build (one milestone per iteration) -> review -> fix -> PR -> wait-review -> fix-review -> wait-checks -> merge | `task`, `interactive` (`plan`), `review_runtime` (`claude`), `reviewers` (`claude`), `slug`, `max_milestones` (`12`), `use_worktree` (`false`) |
| `esp-go-light` | `esp-ship --track inline --stop-before-wait` -> wait-review -> fix-review -> wait-checks -> merge                                            | `task`, `reviewers` (`claude`), `use_worktree` (`false`)                                                                                       |
| `esp-epic`     | epic file for the overseer backlog -> hand-off                                                                                               | `source`                                                                                                                                       |

- Every step is a steering boundary: `af send` reaches the next step (or the next build iteration) as an `## Operator Messages` section, and the skills log what they applied in `decisions.jsonl`
- `af amend` on `esp-go` reruns the `plan` step at the next boundary, which amends the plan (`plan.v<N>.md`); the next build iteration builds from it and keeps the done milestones
- Each `build` iteration runs `esp-ship --milestone next` in a fresh session: one milestone, one verified commit. The iteration reads the esp-ship skill file from the installed plugin, because a loop prompt cannot start with a slash command
- `review_runtime=codex` runs the internal review on Codex (the skill is inlined); every other step runs on Claude
- Waiting for the bot reviews and the checks runs in the harness, with no agent session; `merge` runs `esp-merge` under the harness merge lock (`AF_MERGE_LOCK`)
- `esp-go-light` stops blocked when the task outgrows the inline track (`escalate`): resume it, or run `esp-go` on the task

### Shared References

Workflow skills and agents share these references at the plugin root, reached through `${CLAUDE_PLUGIN_ROOT}`:

- `references/decision-policy.md`: classes A-Fix, B-Decide, B-Scope, Reject and Halt, interactive and autonomous behavior, `needs_input` under a harness, `ship.halt_on` stop conditions, risk levels and decision logging
- `references/summary-template.md`: frontmatter and sections of a run `summary.md`
- `references/plan-format.md`: plan format 1, the milestone block, parsed JSON, amendments and plan-lint
- `references/model-selection.md`: roles and the model and effort precedence (`--model` -> milestone complexity -> config role -> agent frontmatter -> inherit)

## Complete Examples

Arguments follow CLI conventions: every discrete value is a named option with a short and a long name (`-t|--type <type>`, also `--type=<value>`), flags are switches (`-w|--draft`), and only trailing free text (`[context]`, `<question>`) is positional. Repeatable options (`-r|--reviewers <name>...`) take the option several times (`-r claude -r codex`) or a comma-separated value (`-r claude,codex`). Quote a value that contains spaces.

### /esp-skills:esp-branch

**Arguments:**

- `-s|--slug <slug>` - Short kebab-case description (required)
- `[-t|--type <type>]` - Branch type: feature (default: `branch.default_category`), fix, chore, doc, poc, refactor
- `[-g|--issue <id>]` - GitHub issue number
- `[-b|--base <branch>]` - Base branch to create from (defaults to current location)

**Examples:**

```bash
# Simple branch (defaults to feature/add-dark-mode)
/esp-skills:esp-branch --slug add-dark-mode

# With a type
/esp-skills:esp-branch --slug login-timeout --type fix

# With issue reference
/esp-skills:esp-branch --slug add-oauth --type feature --issue 123

# Branch from a specific base branch, with short names
/esp-skills:esp-branch -s add-oauth -t feature -g 123 -b develop
```

### /esp-skills:esp-commit

**Arguments:**

- `[-m|--message <title>]` - Override commit title (auto-generated if not provided)

**Examples:**

```bash
# Auto-generate commit message from changes
/esp-skills:esp-commit

# With custom message
/esp-skills:esp-commit --message "Fix login timeout on Safari"
/esp-skills:esp-commit -m "Fix login timeout on Safari"
```

### /esp-skills:esp-pr

**Arguments:**

- `[-w|--draft]` - Create the PR as a draft
- `[-b|--base <branch>]` - Target branch for the PR (defaults to `pr.base`, or the repository default branch)
- `[-d|--run-dir <path>]` - Run directory: the body is built from its artifacts (`pr.body_from_run`) and the PR URL is recorded

**Examples:**

```bash
# Create PR to default branch
/esp-skills:esp-pr

# Create PR to specific branch
/esp-skills:esp-pr --base develop

# Create draft PR to a specific branch, with short names
/esp-skills:esp-pr -w -b develop

# Build the body from a run's plan, decisions and review resolution
/esp-skills:esp-pr --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
```

### /esp-skills:esp-config

**Arguments:**

- `<action>` - `init`, `show`, `get`, `set`, `unset`, `validate`, or `sources` (required, leading positional)
- `[-P|--project]` - Target `<repo>/.esp-skills/config.json` instead of the user file
- `[-f|--force]` - Overwrite an existing file on `init`
- `[-k|--key <key>]` - Section or dotted key for `get`, `set`, `unset`; a file path for `validate`
- `[value]` - Value for `set` (trailing free text), parsed as JSON when valid, otherwise a string

**Examples:**

```bash
# Create ~/.esp-skills/config.json
/esp-skills:esp-config init

# Create a project config in the current repository, overwriting an existing one
/esp-skills:esp-config init --project --force

# Show the merged config, or one section or key
/esp-skills:esp-config show
/esp-skills:esp-config get --key pr
/esp-skills:esp-config get --key defaults.models.reviewer

# Change a value for every repository, or only this one
/esp-skills:esp-config set --key pr.draft true
/esp-skills:esp-config set -P -k pr.base develop
/esp-skills:esp-config set --key merge.preference '["squash","merge"]'

# Remove a key, validate all layers or one file, list layers
/esp-skills:esp-config unset --key pr.draft
/esp-skills:esp-config validate
/esp-skills:esp-config validate --key ./candidate-config.json
/esp-skills:esp-config sources
```

### /esp-skills:esp-fix-review

**Arguments:**

- `[-l|--internal]` - Fix the findings of an `esp-review` run (`review-<N>.json`) instead of PR comments, without pushing
- `[-w|--wait]` - Before round 1, wait until every reviewer has reviewed the head commit and no CI check is pending
- `[-t|--timeout <minutes>]` - Time limit of each wait (default: `fix-review.wait.timeout_minutes`)
- `[-m|--rounds <n>]` - Maximum fix rounds across invocations (default: `fix-review.max_rounds`)
- `[-r|--reviewers <name>...]` - Only handle, and wait for, these reviewers (names from `fix-review.wait.reviewers`, or logins; default: `fix-review.wait.default_reviewers`)
- `[-i|--interactive <mode>]` - `off`, `plan` or `all` (`all` asks about B-Decide and B-Scope items and shows a recap before pushing)
- `[-p|--pr <pr>]` - Pull request number, `#<n>` or URL (default: the PR of the current branch)
- `[-e|--findings <path>]` - With `--internal`, the findings file to apply (default: the latest `review-<N>.json` of the run)
- `[-d|--run-dir <path>]` - Keep the state in the run, log every resolution, record step `fix-review`
- `[-c|--config-snapshot <path>]` - Read this config snapshot instead of the user and project layers

**Examples:**

```bash
# Fix the comments and CI failures on the PR of the current branch, up to 3 rounds
/esp-skills:esp-fix-review

# Handle only Codex's comments on PR 42, in one round
/esp-skills:esp-fix-review --rounds 1 --reviewers codex --pr 42
/esp-skills:esp-fix-review -m 1 -r codex -p 42

# Wait for Codex and Claude to review the head commit and for the CI checks, at most 10 minutes, then fix
/esp-skills:esp-fix-review --wait --timeout 10 --reviewers codex --reviewers claude --pr 42
/esp-skills:esp-fix-review -w -t 10 -r codex,claude -p 42

# Settle B-Decide and B-Scope comments with the user
/esp-skills:esp-fix-review --interactive all --pr https://github.com/o/r/pull/42

# Apply the latest esp-review findings of a run, or a given findings file
/esp-skills:esp-fix-review --internal --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
/esp-skills:esp-fix-review --internal --findings /tmp/esp-review-x1/review-1.json
```

### /esp-skills:esp-merge

**Arguments:**

- `[-n|--dry-run]` - Check the conditions and resolve the method without rebasing or merging
- `[-m|--method <method>]` - `repo`, `squash`, `rebase` or `merge`; errors when the repository does not allow it (default: `merge.method`)
- `[-i|--interactive <mode>]` - `off`, `plan` or `all`; `all` asks before merging (default: `defaults.interactive`)
- `[-p|--pr <pr>]` - Pull request number, `#<n>` or URL (default: the PR of the current branch)
- `[-d|--run-dir <path>]` - Read halt signals from a run directory, log the decision, record step `merge`
- `[-c|--config-snapshot <path>]` - Read this config snapshot instead of the user and project layers

**Examples:**

```bash
# Merge the PR of the current branch when it is ready
/esp-skills:esp-merge

# See what would happen on PR 42, without merging
/esp-skills:esp-merge --dry-run --pr 42
/esp-skills:esp-merge -n -p 42

# Force a rebase merge, and confirm before merging
/esp-skills:esp-merge --method rebase --interactive all --pr https://github.com/o/r/pull/42

# Merge as a workflow step: halts in the run block the merge
/esp-skills:esp-merge --pr 42 --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login
```

### /esp-skills:esp-review

**Arguments:**

- `[-a|--focus <area>]` - Comma-separated dimensions to review (`security,tests`), or a concern to weigh more heavily
- `[-p|--plan <path>]` - Plan the diff implements, for `plan-conformance` (default with `--run-dir`: the run's latest plan)
- `[-t|--target <target>]` - What to review. Omit for local changes (or the branch against the default branch when the tree is clean). Accepts `staged`, `unstaged`, a ref (`main`, `origin/main`), a range (`main..HEAD`), or a PR (`"PR 123"`, `#123`, a PR URL)
- `[-i|--interactive <mode>]` - `off`, `plan` or `all`; `all` settles B-Decide and B-Scope findings with you (default: `defaults.interactive`)
- `[-d|--run-dir <path>]` - Save `review-<N>.diff`, `.md` and `.json` in a run and record step `review-<N>` (default: a temporary directory, no run)
- `[-c|--config-snapshot <path>]` - Config snapshot from a harness or parent run

**Examples:**

```bash
# Review all local changes (staged, unstaged and untracked, or the branch if clean)
/esp-skills:esp-review

# Review only staged changes, e.g. as a pre-commit sanity check
/esp-skills:esp-review --target staged

# Review the current branch against main, or an explicit range
/esp-skills:esp-review --target main
/esp-skills:esp-review -t origin/main..HEAD

# Review a GitHub pull request (requires gh to be authenticated)
/esp-skills:esp-review --target "PR 123"
/esp-skills:esp-review --target #123

# Review only security and tests, or weigh a concern more heavily
/esp-skills:esp-review --focus security,tests --target main
/esp-skills:esp-review --focus "token refresh" --target "PR 123"

# Check the build of a run against its plan, saving the review in the run
/esp-skills:esp-review --target main --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login

# Settle B-Decide and B-Scope findings interactively
/esp-skills:esp-review --interactive all
```

### /esp-skills:esp-plan

**Arguments:**

- `[-a|--amend]` - Amend the latest plan in `--run-dir`; `[context]` is the amendment (text or file)
- `[-I|--import <path>]` - Convert a task list or a design document into a plan with no codebase exploration: one milestone per unchecked package
- `[-t|--type <type>]` - `feature`, `bug`, `chore` or `auto` (default: `plan.default_type`)
- `[-i|--interactive <mode>]` - `off`, `plan` or `all` (default: `defaults.interactive`)
- `[-d|--run-dir <path>]` - Use an existing run directory (default: a new run under `runs.root`)
- `[-c|--config-snapshot <path>]` - Config snapshot from a harness or parent run
- `[context]` - Task description, issue URL or document path

**Examples:**

```bash
# Plan a feature with context
/esp-skills:esp-plan --type feature Add user authentication with OAuth for Google and GitHub

# Plan a bug fix from an issue
/esp-skills:esp-plan --type bug https://github.com/acme/web/issues/42

# Plan a chore, with short names
/esp-skills:esp-plan -t chore Update all npm dependencies to latest versions

# Auto-detect type, and approve the plan before it is final
/esp-skills:esp-plan --interactive plan Fix the login timeout issue

# Import the unchecked packages of a task list as milestones
/esp-skills:esp-plan --import docs/backlog.md

# Amend the remaining milestones of an existing plan
/esp-skills:esp-plan --amend --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login Also support GitHub OAuth
```

### /esp-skills:esp-ship

**Arguments:**

- `[-u|--resume]` - Continue the run in `--run-dir` from `ship.json`, or take over a caller-owned run that escalated
- `[-w|--worktree]` - Work in a task worktree under `worktrees.root` (default: `ship.worktree`)
- `[-b|--branch <name>]` - Work on this branch: checked out, tracked from `origin`, or created from `origin/<base>` (default: the current feature branch, else a new branch)
- `[-P|--no-pr]` - Stop after the last commit and the internal review: no push, no PR
- `[-M|--no-merge]` - Stop after the PR review fixes, with the PR open
- `[-s|--stop-before-wait]` - End once the PR is open; the caller waits, fixes and merges
- `[-l|--parallel]` - Build milestones with disjoint files in parallel worktrees (default: `ship.parallel`)
- `[-t|--track <track>]` - `inline` or `orchestrated`, instead of the triage choice
- `[-p|--plan <mode>]` - `auto`, `skip` (no planning model) or `always` (default: `ship.plan_mode`)
- `[-R|--review <mode>]` - `auto`, `internal`, `pr`, `both` or `none` (default: `ship.review_mode`)
- `[-e|--milestone <id>]` - Build one milestone of the plan in `--run-dir` and exit; `next` picks the next runnable one
- `[-a|--model <alias>]` - Builder model for every milestone (`opus`, `sonnet`, `haiku`, `fable`)
- `[-m|--max-rounds <n>]` - PR fix rounds (default: `fix-review.max_rounds`)
- `[-r|--reviewers <name>...]` - Reviewers to wait for and fix (default: `fix-review.wait.default_reviewers`)
- `[-i|--interactive <mode>]` - `off`, `plan` (approve the plan or the inline approach) or `all` (also review findings, PR rounds and merge) (default: `defaults.interactive`)
- `[-d|--run-dir <path>]` - Run directory owned by a harness or a parent skill, or a run to resume (default: a new run under `runs.root`)
- `[-c|--config-snapshot <path>]` - Config snapshot from a harness or parent run
- `[context]` - The task: a description, an issue URL or `#<number>`, or a path to a plan, a task list or a design document

**Examples:**

```bash
# A small prompt: the inline track, one commit, PR, bot review fixes and merge
/esp-skills:esp-ship Add a JSON output option to the status command

# A feature from an issue: triage picks the track; approve the plan first, in a separate worktree
/esp-skills:esp-ship --worktree --interactive plan https://github.com/o/r/issues/31

# A plan from esp-plan, with sonnet as the builder and milestones built in parallel
/esp-skills:esp-ship --model sonnet --parallel ~/.esp-skills/runs/2026-11-10-add-oauth-login/plan.md

# A task list: import the unchecked packages, stop before the PR
/esp-skills:esp-ship --no-pr docs/backlog.md
/esp-skills:esp-ship -P docs/backlog.md

# Ship fast: no planning model, bot review only
/esp-skills:esp-ship --plan skip --review pr Rename the config loader to settings
/esp-skills:esp-ship -p skip -R pr Rename the config loader to settings

# Force milestones for a small prompt, with both reviews
/esp-skills:esp-ship --track orchestrated --plan always --review both Add rate limiting to the login route

# Continue on an existing branch, stop with the PR open, waiting for Codex, two fix rounds
/esp-skills:esp-ship --branch feature/session-store --no-merge --reviewers codex --max-rounds 2 Add a session store
/esp-skills:esp-ship -b feature/session-store -M -r codex -m 2 Add a session store

# Continue an interrupted run, or take over a caller-owned run that escalated
/esp-skills:esp-ship --resume --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login

# Run only the next milestone, as a harness loop iteration would
/esp-skills:esp-ship --milestone next --run-dir ~/.esp-skills/runs/2026-11-10-add-oauth-login

# A harness workflow step: inline, end once the PR is open, with the harness config
/esp-skills:esp-ship -t inline -s -d ~/.agentic-forge/runs/2026-11-10-status-json -c ~/.agentic-forge/runs/2026-11-10-status-json/config.json Add a JSON output option
```

### /esp-skills:esp-recap

**Arguments:**

- `[-k|--risks]` - Risk report: high-risk decisions, critical findings, halted and waiting runs
- `[-a|--all]` - No date filter (default: the last `recap.default_range_days` days)
- `[-s|--since <date>]`, `[-e|--until <date>]` - Date range, `YYYY-MM-DD`, on the run directory date
- `[-l|--last <span>]` - Shortcut for `--since`: `<N>d`, `<N>w` or `<N>h`
- `[-g|--repo <name>]` - Only runs of this repository
- `[-t|--status <status>...]` - Only runs with these statuses
- `[-x|--risk <level>]` - Only runs whose `max_risk` is at least `low`, `medium` or `high`
- `[-c|--config-snapshot <path>]` - Config snapshot from a harness
- `[context]` - Empty for a recap, a run ID or path for one run, or a question for Q&A

**Examples:**

```bash
# Recap the runs of the last 7 days (recap.default_range_days)
/esp-skills:esp-recap

# Recap the merged and halted runs of one repository this month
/esp-skills:esp-recap --since 2026-11-01 --repo api --status merged,halted
/esp-skills:esp-recap -s 2026-11-01 -g api -t merged -t halted

# Recap one run
/esp-skills:esp-recap 2026-11-10-add-token-refresh

# Risk report over every run
/esp-skills:esp-recap --risks --all

# Ask why a decision was made, with sources
/esp-skills:esp-recap Why do refresh tokens rotate on every use?
```

### /esp-skills:esp-analyze

**Arguments:**

- `-t|--type <type>` - Analysis type: `bug`, `debt`, `doc`, `security`, or `style` (required)
- `[context]` - Focus areas or directories to analyze

**Examples:**

```bash
# Bug analysis
/esp-skills:esp-analyze --type bug
/esp-skills:esp-analyze --type bug Focus on error handling in API routes
/esp-skills:esp-analyze -t bug src/api/ src/services/

# Documentation analysis
/esp-skills:esp-analyze --type doc Check API documentation accuracy

# Technical debt analysis
/esp-skills:esp-analyze --type debt Focus on database access patterns

# Style analysis
/esp-skills:esp-analyze --type style Check naming conventions in React components

# Security analysis
/esp-skills:esp-analyze --type security Focus on authentication and session management
```

### /esp-skills:esp-qna

**Arguments:**

- `<question>` - The question to answer

**Examples:**

```bash
# Ask a technical question
/esp-skills:esp-qna What is the difference between let and const in JavaScript?

# Ask for best practices
/esp-skills:esp-qna What are the best practices for error handling in Node.js?
```

### /esp-skills:esp-rubberduck

**Arguments:**

- `<context>` - The idea, plan, code snippet, or issue to discuss

**Examples:**

```bash
# Clarify a plan
/esp-skills:esp-rubberduck I'm planning to extract the token validation logic into a separate middleware.

# Debug an issue
/esp-skills:esp-rubberduck My component is not re-rendering when the prop changes.

# Discuss a design decision
/esp-skills:esp-rubberduck Should we use Redux or Context API for state management in this project?
```

### /esp-skills:esp-markdown

This skill takes no arguments. It is automatically invoked when creating, editing, or reviewing markdown files.

```bash
# Review a markdown file for style issues
/esp-skills:esp-markdown
```

### /esp-skills:esp-create-skill

**Arguments:**

- `-s|--skill <name>` - Name for the new skill in kebab-case (e.g., `review-code`, `analyze-deps`) (required)
- `[context]` - Additional context about what the skill should do

**Examples:**

```bash
# Create a skill with just a name
/esp-skills:esp-create-skill --skill deploy-staging

# Create a skill with context, with the short name
/esp-skills:esp-create-skill -s review-pr A skill that reviews pull requests for code quality and security issues
```

### agentic-forge workflows

**Variables:** see [Running Under agentic-forge](#running-under-agentic-forge).

**Examples:**

```bash
# Plan, approve, build one commit per milestone, review, PR, merge
af run esp-go --var "task=Add OAuth login"

# No plan approval, internal review on Codex, wait for Claude and Codex on the PR
af run esp-go --var "task=#31" --var interactive=off --var review_runtime=codex --var reviewers=claude,codex

# Small task in its own worktree, beside another run of the same repository
af run esp-go-light --var "task=Fix the off-by-one in the pager" --var use_worktree=true

# Steer a running esp-go run, or change its scope at the next boundary
af send <run> "Reuse the existing session store"
af amend <run> "Drop the migration milestone"

# Turn an epic into a backlog file for the overseer
af run esp-epic --var "source=docs/epics/search.md"
```
