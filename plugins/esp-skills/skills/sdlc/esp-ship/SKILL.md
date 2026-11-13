---
name: esp-ship
description: Ship a task to a merged pull request, inline or as verified milestones
argument-hint: "[-u|--resume] [-w|--worktree] [-b|--branch <name>] [-P|--no-pr] [-M|--no-merge] [-s|--stop-before-wait] [-l|--parallel] [-t|--track <track>] [-p|--plan <mode>] [-R|--review <mode>] [-e|--milestone <id>] [-a|--model <alias>] [-m|--max-rounds <n>] [-r|--reviewers <name>...] [-i|--interactive <mode>] [-d|--run-dir <path>] [-c|--config-snapshot <path>] [context]"
disable-model-invocation: true
metadata: { af-contract: 1, af-level: recappable }
---

# ESP Ship

## Overview

Take any task from request to merged pull request: a one-line fix, a clear chore, a feature prompt, a GitHub issue, or a plan from `esp-plan`. Triage picks the track. The inline track does the work in this session with one commit. The orchestrated track plans the work, then this session spawns one `esp-builder` and one `esp-verifier` per milestone, so each milestone is one verified commit, and runs the internal review. Both tracks share the same tail: open the pull request, wait for the bot reviews and the CI checks, fix both, refresh the body from the run artifacts, and merge under objective conditions. `scripts/ship.mjs` decides what runs next, with which model, and when the task stops. The state lives in `<run-dir>/ship.json` (phases) and `<run-dir>/state.json` (milestones), so an interrupted run resumes where it stopped.

`preflight -> triage -> [plan] -> branch -> implement (inline) or build (milestones) -> [internal review <-> fix] -> PR -> [wait (reviews + checks) <-> fix-review] -> refresh body -> merge -> summary`

## Arguments

### Definitions

- **`[-u|--resume]`** (optional): Continue the run in `--run-dir` from `ship.json`. Lifts an `awaiting-human` stop, or takes over a caller-owned run that escalated. Fails when the run has no `ship.json`.
- **`[-w|--worktree]`** (optional): Work in a task worktree under `worktrees.root`, so the current checkout stays untouched. Defaults to `ship.worktree` (`false`). A dirty working tree also runs in a task worktree, per `ship.dirty_tree` (`worktree`).
- **`[-b|--branch <name>]`** (optional): Work on this branch: checked out when it exists locally, tracked when it exists on `origin`, else created from `origin/<base>`. Defaults to the current branch when it is not the base or the default branch, else a new branch named per `branch.pattern`.
- **`[-P|--no-pr]`** (optional): Stop after the last commit and the internal review: no push, no pull request.
- **`[-M|--no-merge]`** (optional): Stop after the pull request review fixes, with the pull request left open.
- **`[-s|--stop-before-wait]`** (optional): End once the pull request is open. The caller waits for the reviews, fixes them and merges (for example a harness workflow with its own wait step). No `summary.md` is written: the caller ends the task.
- **`[-l|--parallel]`** (optional): Build milestones whose dependencies are done and whose files do not overlap at the same time, each in its own worktree, even when `ship.parallel` would not. Without it, `ship.parallel` decides (`auto`: on when the plan has a batch of two or more such milestones and `worktrees.root` is usable).
- **`[-t|--track <track>]`** (optional): `inline` or `orchestrated`. Pins the track instead of letting triage pick it.
- **`[-p|--plan <mode>]`** (optional): `auto`, `skip` or `always`. `skip` uses no planning model: a plan file is reused, a task list imported, a small request runs inline, and a larger one gets a synthesized one-milestone plan. `always` generates a plan even for a small prompt. Defaults to `ship.plan_mode` (`auto`).
- **`[-R|--review <mode>]`** (optional): `auto`, `internal`, `pr`, `both` or `none`. `internal` keeps only the internal review, `pr` only the bot review rounds, `none` drops both (the merge still needs green checks). `auto` keeps the bot review and decides the internal review after the build from the real diff (see review.md). Defaults to `ship.review_mode` (`auto`).
- **`[-e|--milestone <id>]`** (optional): Build one milestone of the plan in `--run-dir` and exit with a `build-<id>` result block. `next` picks the next runnable milestone, an ID such as `M2` runs that one when its dependencies are done. Used by loop-driven harness steps: `esp-ship --milestone next --run-dir <dir>`.
- **`[-a|--model <alias>]`** (optional): Builder model for every milestone: `opus`, `sonnet`, `haiku` or `fable`. Overrides the complexity-based choice. The verifier keeps its role model.
- **`[-m|--max-rounds <n>]`** (optional): Pull request fix rounds. Defaults to `fix-review.max_rounds` (`3`).
- **`[-r|--reviewers <name>...]`** (optional): Reviewer names from `fix-review.wait.reviewers` (`claude`, `codex`) or GitHub logins, repeated (`-r claude -r codex`) or comma-separated. Defaults to `fix-review.wait.default_reviewers`.
- **`[-i|--interactive <mode>]`** (optional): `off`, `plan` or `all`. `plan` approves the plan (or the inline approach), then runs on its own. `all` also stops at the internal review findings, after each pull request fix round, and before the merge. Defaults to `defaults.interactive` (`off`). Headless sessions and subagents always use `off`.
- **`[-d|--run-dir <path>]`** (optional): Run directory owned by a harness or a parent skill, unless this skill created it. Without it, the skill creates and owns its run under `runs.root`.
- **`[-c|--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run. Frozen in `ship.json` on the first call.
- **`[context]`** (required unless resuming or with `--milestone`): The task: a description, a GitHub issue URL or `#<number>`, or a path to a file that describes it (a plan, a task list, a design document).

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For triage (the track and the plan source), see [triage.md](references/triage.md)
- For the plan phase, see [plan.md](references/plan.md)
- For the inline track (context and implement), see [inline.md](references/inline.md)
- For the milestone loop and `--milestone` mode, see [milestones.md](references/milestones.md)
- For the internal review loop, see [review.md](references/review.md)
- For the pull request, the review wait, the fix rounds and the merge, see [pr-tail.md](references/pr-tail.md)
- For the branch, the worktree and the preflight of the tree, see [workspace.md](references/workspace.md)
- For the gate commands, the scoped checks and the final gates, see [gates.md](references/gates.md)
- For the classes, the stop conditions and asking under a harness, see [decision-policy.md](../../../references/decision-policy.md)
- For the subagent models, see [model-selection.md](../../../references/model-selection.md)
- For `summary.md`, see [summary-template.md](../../../references/summary-template.md)
- For the run directory commands and exit codes, see [contract-notes.md](../../../references/contract-notes.md)

## Core Principles

- This session orchestrates. It runs the inline phases itself and spawns every other phase in a fresh subagent, keeping only each result line. Details stay in the run directory
- `ship.mjs next` decides the phase, the model and the loop. Every state change goes through `ship.mjs` and `runs.mjs`, the only writers of `ship.json`, `state.json`, `run.json`, `decisions.jsonl` and the result files
- Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path. The scripts take long option names only, and `--reviewers` as one comma-separated value
- The inline track makes one implementation commit. The orchestrated track makes one verified commit per milestone. Review fixes are separate `fix(review): ...` commits
- A milestone is done only when an independent `esp-verifier` passes it: the builder's own report never counts
- A halted task stays unmerged. Push only the task branch, force-push only after a rebase of the task branch, and respect branch protection
- Waiting costs no tokens: the review and checks wait runs as a background script in this session
- Log each decision this session makes with `runs.mjs decision`, when it is made

## Skill-Specific Guidelines

### Configuration

Read the sections once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get ship
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get fix-review
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get pr
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), stop: the dispatch needs the scripts. The keys this session reads:

- **`ship.phases`** (default: every phase of the track): the phases to run, filtered per track. The core phase (`implement` or `build`) is required, and the orchestrated track always plans
- **`ship.internal_review_rounds`** (`2`): internal review and fix rounds before the pull request. `0` skips the internal review, like `--review pr`
- **`ship.plan_mode`** (`auto`), **`ship.review_mode`** (`auto`), **`ship.auto.review_max_files`** (`3`), **`ship.auto.review_max_lines`** (`150`) and **`ship.review.always_paths`**: the plan and review modes, and the review gate (see plan.md and review.md)
- **`ship.worktree`** (`false`): work in a task worktree when `--worktree` is not given
- **`ship.pr_draft_until_reviewed`** (`true`): open the pull request as a draft, and mark it ready once its body is in place
- **`ship.inline.max_files_changed`** (`10`) and **`ship.inline.escalate`** (`true`): the inline limit and whether going over it moves the task to the orchestrated track
- **`ship.budgets.inline.max_wall_minutes`** (`60`), **`ship.budgets.orchestrated.max_wall_minutes`** (`240`) and **`ship.budgets.orchestrated.max_milestones`** (`12`): budgets checked at each phase boundary
- **`ship.halt_on`** (all five stop conditions): the stop conditions honored (see decision-policy.md)
- **`ship.max_retries_per_milestone`** (`2`), **`ship.parallel`** (`auto`), **`ship.max_parallel`** (`3`), **`ship.commit_per_milestone`** (`true`): the milestone loop
- **`ship.gates.<test|lint|typecheck|build>`** (`null`: detected), **`ship.gates.always`** (`[]`) and **`ship.gates_scope`** (`milestone`): the gate commands, and the checks each builder, verifier and fixer runs (see gates.md)
- **`fix-review.max_rounds`** (`3`) and **`fix-review.wait.default_reviewers`** (`["claude"]`): the pull request rounds and the reviewers waited for
- **`pr.base`** (`null`: the repository default branch), **`pr.draft`** (`false`), **`pr.body_from_run`** (`true`) and **`pr.body_sections`**: the pull request
- **`defaults.models.<role>`** (see model-selection.md) and **`defaults.interactive`** (`off`)

The phase skills read their own sections (`plan`, `review`, `fix-review`, `merge`, `branch`, `commit`, `worktrees`) through the frozen snapshot.

### Task State

`scripts/ship.mjs` owns `<run-dir>/ship.json`, and `ship.mjs milestone <cmd>` owns `<run-dir>/state.json`. Every command takes `--run-dir <path>`. `node "${CLAUDE_PLUGIN_ROOT}/scripts/ship.mjs" --help` lists them all with their options:

- **`init`**: create the state from `--request`, `--track`, `--base` and the flags, resolve the phases of the track, freeze the config. A second call prints the state, and `--resume` lifts an `awaiting-human` stop or takes over an escalated caller-owned run
- **`next`**: what to run now, `{ action, track, phase, sub, skill, role, model, effort, cwd, ... }`
- **`phase <name> --status started|done|skipped|failed`**: record a phase and its facts (`--plan`, `--branch`, `--base-sha`, `--commit`, `--pr`, `--summary`, `--gates`)
- **`budget`**, **`scope`**, **`gate-failure`**, **`switch-track`**, **`escalate`**: the inline limits and the move to the orchestrated track (see inline.md)
- **`workspace`**, **`worktree`**: pick and apply the workspace of the branch phase, or create a task worktree directly (see workspace.md)
- **`final-gates --result pass|fail`**: record a run of the full gates after the build (see gates.md)
- **`review-gate`**: decide the internal review of `--review auto` from the diff of the build (see review.md)
- **`review-loop`**, **`pr-loop`**: the internal review rounds and the pull request rounds
- **`milestone init|next|start|finish|models|reuse|agent|gates|show`**: the milestone loop (see milestones.md)
- **`stop`**, **`halt`**: record a stop, or halt under a `ship.halt_on` key (exit 20)
- **`pr-body`**, **`result`**: the pull request body from the run artifacts, and the final result block

`next` actions:

- **`run`**: run `phase` (and `sub` for the review loop). Follow the reference file of the phase (see Phase Map). `resumed: true` means the phase started before an interruption: run it again, the phase skills pick up their own state
- **`review-gate`**: run `ship.mjs review-gate`, then `next` again (see review.md)
- **`complete`**: the internal review loop ended. Record `phase review --status done`
- **`halt`**: run `ship.mjs halt` with its `key` and `reason`
- **`stop`**: run `ship.mjs stop` with its `status` and `reason`
- **`result`**: go to the result

### Phase Map

- **`context`, `implement`** (inline track): in this session, see [inline.md](references/inline.md)
- **`plan`** (orchestrated track): see [plan.md](references/plan.md)
- **`branch`**: see [workspace.md](references/workspace.md)
- **`build`** (orchestrated track): the milestone loop in this session, see [milestones.md](references/milestones.md)
- **`final-gates`** (orchestrated track): the full gates once in this session, see [gates.md](references/gates.md)
- **`review`** with `sub: review` or `sub: review-fix`: see [review.md](references/review.md)
- **`pr`**, **`fix-review`** (each round starts with the `fix-review-wait` step), **`merge`**: see [pr-tail.md](references/pr-tail.md)

### Phase Subagents

Spawn each subagent phase with the Agent tool, `subagent_type: general-purpose`, with the `model` and `effort` from `next` (omit `model` when it is `inherit`). Record it with `runs.mjs update --model <role>=<model>[:<effort>]`. Run it in the foreground. The prompt is self-contained:

```markdown
You run one phase of an esp-ship task. Read <plugin-root>/skills/<path>/SKILL.md and follow its Instructions as if
invoked with: <arguments>. In that file, ${CLAUDE_PLUGIN_ROOT} means <plugin-root>.
Work in <cwd>. You are a subagent: never ask questions (interactive mode off); wait in the foreground, at most
10 minutes per command, when the skill says to wait in the background.
<extra context>
End with the result line printed by runs.mjs result, copied exactly, as your final line.
```

`<plugin-root>` is the value of `${CLAUDE_PLUGIN_ROOT}` in this session (`echo "${CLAUDE_PLUGIN_ROOT}"`). `<arguments>` uses long option names. Every phase skill that takes them also gets `--run-dir <run-dir> --config-snapshot <config_snapshot from ship.json>`. Pending operator messages go in `<extra context>` as an `## Operator Messages` section.

Before spawning a phase, record `phase <name> --status started`. After it returns, act on its result status: `done` (or `merged` for the merge) records `phase <name> --status done`. `halted` runs `ship.mjs stop --status halted --reason <summary>` (the phase logged its Halt decision). `awaiting-human` or `failed` runs `ship.mjs stop` with that status, unless Waiting and Open Items says otherwise. A subagent that returns no valid result line counts as `failed` with reason `no result block`.

The milestone builders and verifiers are not phase subagents: this session spawns them as `esp-skills:esp-builder` and `esp-skills:esp-verifier` (see milestones.md).

### Waiting and Open Items

- A plan that returns `awaiting-human` (open questions): in `plan` or `all` mode, ask, log the answers as operator decisions, and run the plan phase again with `--amend` and the answers. In `off` mode, `ship.mjs stop --status awaiting-human`.
- Open pull request review items, or a merge blocked by a condition, end the task with `awaiting-human` and the pull request left open.
- With a caller-owned `--run-dir`, an `awaiting-human` phase ends the skill with that status. The result block passes its `needs_input` through, so the caller can answer and run the skill again with the same `--run-dir`.

### Interactive Checkpoints

Only in `plan` or `all` mode, standalone and not headless. This session does the asking, logs each answer with `runs.mjs decision` (`source: operator`), and passes it to the next subagent as an operator message:

- **After the plan, or after the inline context phase** (`plan`, `all`): approve the plan (title, milestones, risks, open questions) or the approach and the files, or give feedback. Feedback runs the plan again with `--amend`
- **Before each internal fix** (`all`): the findings by class (`by_class` from the review result, details in `findings_path`). Fix as recommended, or choose for the B items
- **After each pull request round** (`all`): the round recap (fixed, rejected, deferred). Continue, or stop with the pull request open
- **Before the merge** (`all`): merge now, or stop with the pull request open

### Operator Messages

At each phase boundary, read the injected `## Operator Messages` section (first boundary only) and `runs.mjs messages`. Pass the pending messages to the next subagent (or apply them in this session on the inline track), then deliver them with `runs.mjs deliver <id>`. A message that says to stop is `ship.mjs halt --key scope-change` (or `destructive-action` when it names one). A message that changes the plan runs the plan phase again with `--amend` and the message before the next milestone. On the inline track, a message that widens the task is a `design` escalation (see inline.md).

## Instructions

1. **Parse arguments**: read each option by its short or long name (`-w` or `--worktree`, `-m 2` or `--max-rounds 2`, `--track=inline` too), and the trailing `[context]`. Collect every `-r`/`--reviewers` value into one comma-separated list. Resolve the interactive mode: `-i`/`--interactive`, else `defaults.interactive`, `off` when headless or in a subagent. `--resume` or `--milestone` without `--run-dir`, `--resume` on a run without `ship.json`, an unknown `--track`, `--plan`, `--review` or `--model` value, or no `[context]` on a new run is a usage error: report it and stop.
2. **Load configuration** (see Configuration).
3. **Milestone mode**: with `--milestone`, follow Single Milestone Mode in [milestones.md](references/milestones.md) and stop there. The steps below do not apply.
4. **Preflight**: a git repository, and `gh auth status` succeeds unless `--no-pr`. A dirty working tree is fine (the branch phase moves the task to a worktree, see [workspace.md](references/workspace.md)), except with `--branch` naming the current branch, or with `ship.dirty_tree: fail`. Otherwise report it and stop with `status: failed`.
5. **Resolve the run**: with `--run-dir`, use it (`runs.mjs create --run-dir <path>` is a no-op on an existing run). Otherwise `runs.mjs create <slug> --title <task title> --workflow esp-ship --repo <owner/name or repo path>`. The run is owned when it was created here, or when `ship.json` records `run_owner: self`. Resolve the base: `pr.base`, else the repository default branch.
6. **Triage** (new runs only): run `ship.mjs triage` on the request, with `--plan-mode <mode>` when `--plan` was given, and pick the track and the plan source (see [triage.md](references/triage.md)). Done when `ship.mjs triage --record` has logged the choices. With `nothing_to_do`, skip to step 10 with the triage result.
7. **Initialize**: `ship.mjs init --request <request text> --track <track> --base <base> --project-dir <repo-root>`, with `--caller-owned` when `--run-dir` came from a caller, `--plan-source <source>` from triage, `--plan-mode` and `--review-mode` for `--plan` and `--review`, and the long form of each other flag that was given (`--no-pr`, `--no-merge`, `--stop-before-wait`, `--worktree`, `--max-rounds`, `--interactive`, `--reviewers`, `--config-snapshot`). For a resume, run `ship.mjs init --resume` without `--request`. Done when `init` prints the state.
8. **Loop**: run `ship.mjs next` and act on `action` (see Task State and Phase Map). Before each phase, handle operator messages and the interactive checkpoints. Done when `next` returns `result`.
9. **Result**: `ship.mjs result` piped into `runs.mjs result ship --run-dir <run-dir>`. Pass `--summary` when the default one does not say enough.
10. **Summary and run status** (skip both with `--stop-before-wait`): write `<run-dir>/summary.md` per the summary template (`workflow: esp-ship`, the track in the outcome, `status` is the result status, `escalate` included), from the result block and `decisions.jsonl`, naming each skipped phase with its reason (`outputs.skipped_phases`), until `runs.mjs validate` passes on it. In an owned run, set `runs.mjs update --status` to the result status (`merged`, `done`, `awaiting-human`, `halted`, `failed`). With a caller-owned run, leave both to the caller.
11. **Report** (see Output Guidance), ending with the line printed by `runs.mjs result` as the final output line, copied verbatim.

## Output Guidance

A short report, then the result block as the final line. Orchestrated track:

```markdown
### Ship: Add OAuth login (orchestrated)

- **Plan**: plan.md v1, 3 milestones (approved)
- **Branch**: feature/oauth-login from main
- **Build**: M1 1a2b3c4, M2 5d6e7f8 (2 attempts), M3 9a8b7c6 (gates: test pass, lint pass)
- **Internal review**: 2 rounds; 3 fixed, 1 rejected (D006); clean on round 2
- **PR**: https://github.com/o/r/pull/42; claude reviewed it; 1 round, 2 fixed
- **Merge**: squash (the only method the repository allows); remote branch deleted
- **Summary**: ~/.esp-skills/runs/2026-11-10-oauth-login/summary.md
```

```text
{"contract_version":1,"status":"merged","summary":"Merged \"Add OAuth login\" (3 of 3 milestones): https://github.com/o/r/pull/42 with squash.","files_changed":["src/auth/google.ts","src/routes/login.ts","src/session.ts"],"commit":"9b8e7d6...","pr":"https://github.com/o/r/pull/42","max_risk":"medium","outputs":{"track":"orchestrated","branch":"feature/oauth-login","milestones":["M1","M2","M3"],"milestone_commits":{"M1":"1a2b3c4...","M2":"5d6e7f8...","M3":"9a8b7c6..."},"review_fix_commits":3,"merge":{"outcome":"merged","merged":true,"method":"squash"}}}
```

Inline track:

```markdown
### Ship: Add a --json flag to the status command (inline)

- **Branch**: feature/status-json from main
- **Commit**: 4f2a9c1 Add --json flag to the status command (gates: test pass, lint pass)
- **PR**: https://github.com/o/r/pull/43; claude reviewed 4f2a9c1; 2 fixed, 1 rejected (D004)
- **Merge**: squash; remote branch deleted
- **Summary**: ~/.esp-skills/runs/2026-11-10-status-json/summary.md
```

For a track switch, name the trigger and the reason. For a caller-owned escalation, name where the work is (`escalation.patch` and the stash) and the next command, `/esp-skills:esp-ship --resume --run-dir <run-dir>`. For a halt or `awaiting-human`, name the phase, the blocker, the pull request (left open), and what would unblock it: the next command is `/esp-skills:esp-ship --resume --run-dir <run-dir>`.
