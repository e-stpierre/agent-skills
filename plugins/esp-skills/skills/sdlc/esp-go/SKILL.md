---
name: esp-go
description: Run a feature from request to merged pull request, with phase subagents and a commit per milestone
argument-hint: "[--interactive <mode>] [--worktree] [--reviewers <names>] [--no-pr] [--no-merge] [--max-rounds <n>] [--resume] [--run-dir <path>] [--config-snapshot <path>] [context]"
disable-model-invocation: true
metadata: { af-contract: 1, af-level: recappable }
---

# ESP Go

## Overview

The full workflow for a feature: plan, branch, build one verified commit per milestone, review and fix internally, open the pull request, wait in the background for the bot reviews, fix them, refresh the pull request body from the run artifacts, and merge under objective conditions. The skill is an orchestrator: each phase runs in its own subagent (`esp-plan`, `esp-build`, `esp-review`, `esp-fix-review`, `esp-pr`, `esp-merge`), and this session keeps only the run state and the result lines. `scripts/go.mjs` decides what runs next, with which model, how many review rounds are left, and when the task stops. State lives in `<run-dir>/go.json`, so `--resume` continues an interrupted run, and a run escalated by `esp-go-light` is picked up in place.

`preflight -> plan -> [approve] -> branch -> build -> review <-> fix -> PR -> await-review <-> fix-review -> refresh body -> merge -> summary`

## Arguments

### Definitions

- **`[--interactive <mode>]`** (optional): `off`, `plan` or `all`. `plan` approves the plan, then runs on its own. `all` also stops at the internal review findings, after each pull request fix round, and before the merge. `--interactive=<mode>` also works. Defaults to `defaults.interactive` (`off`). Headless sessions always use `off`.
- **`[--worktree]`** (optional): Build in a task worktree under `worktrees.root`, so the current checkout stays untouched. Defaults to `go.worktree` (`false`).
- **`[--reviewers <names>]`** (optional): Comma-separated reviewer names from `await-review.reviewers` (`claude`, `codex`) or GitHub logins. Defaults to `go.default_reviewers`.
- **`[--no-pr]`** (optional): Stop after the internal review: no push, no pull request.
- **`[--no-merge]`** (optional): Stop after the pull request review fixes, with the pull request left open.
- **`[--max-rounds <n>]`** (optional): Pull request fix rounds. Defaults to `fix-review.max_rounds` (`3`).
- **`[--resume]`** (optional): Continue the run in `--run-dir` from `go.json`. Fails when the run has no `go.json`.
- **`[--run-dir <path>]`** (optional): Run directory. A harness or a parent skill owns it, unless it is a run that `esp-go-light` escalated (esp-go takes that run over). Without it, the skill creates and owns its run under `runs.root`.
- **`[--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run. Frozen in `go.json` on the first call.
- **`[context]`** (required unless resuming or picking up an escalation): The feature: a description, a GitHub issue URL or `#<number>`, or a path to a file that describes it.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the classes, the stop conditions and asking under a harness, see [decision-policy.md](../../../references/decision-policy.md)
- For the phase subagent models, see [model-selection.md](../../../references/model-selection.md)
- For `summary.md`, see [summary-template.md](../../../references/summary-template.md)
- For the run directory commands and exit codes, see [contract-notes.md](../../../references/contract-notes.md)
- The phase skills: [esp-plan](../esp-plan/SKILL.md), [esp-branch](../../git/esp-branch/SKILL.md), [esp-build](../esp-build/SKILL.md), [esp-review](../../review/esp-review/SKILL.md), [esp-fix-review](../../github/esp-fix-review/SKILL.md), [esp-pr](../../git/esp-pr/SKILL.md), [esp-await-review](../../github/esp-await-review/SKILL.md), [esp-merge](../../github/esp-merge/SKILL.md)

## Core Principles

- This session orchestrates and never implements: every phase except the review wait runs in a fresh subagent, and only its final result line comes back. Details stay in the run directory
- `go.mjs next` decides the phase, the model and the loop; never pick them yourself. Every state change goes through `go.mjs` and `runs.mjs`; never write `go.json`, `run.json`, `decisions.jsonl` or result files by hand
- Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path
- One commit per milestone (from `esp-build`); review fixes are separate `fix(review): ...` commits
- A halted task is never merged. Never push to the base branch, never force-push outside a rebase of the task branch, never bypass branch protection
- Waiting never burns tokens: the review wait runs as a background script in this session
- Log each decision this session makes with `runs.mjs decision`

## Skill-Specific Guidelines

### Configuration

Read the sections once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get go
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get pr
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), stop: the dispatch needs the scripts.

| Key                                         | Default                                                                  | Effect                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `go.phases`                                 | `plan, branch, build, review, pr, await-review, fix-review, merge`       | Phases to run, in this order. `build` is required; without `pr`, the wait phases are skipped |
| `go.internal_review_rounds`                 | `2`                                                                      | Review and fix rounds before the pull request. `0` skips the internal review           |
| `go.worktree`                               | `false`                                                                  | Build in a task worktree when `--worktree` is not given                                |
| `go.pr_draft_until_reviewed`                | `true`                                                                   | Open the pull request as a draft and mark it ready once its body is in place, so reviewers start on the final body |
| `go.budgets.max_milestones`                 | `12`                                                                     | A larger plan halts with `budget` (when `budget` is in `go.halt_on`)                    |
| `go.budgets.max_wall_minutes`               | `240`                                                                    | Wall time budget, checked by `go.mjs next` at each phase boundary                      |
| `go.halt_on`                                | all five stop conditions                                                 | Stop conditions honored (see decision-policy.md)                                       |
| `go.default_reviewers`                      | `["claude"]`                                                             | Reviewers to wait for and fix when `--reviewers` is not given                          |
| `fix-review.max_rounds`                     | `3`                                                                      | Pull request fix rounds when `--max-rounds` is not given                               |
| `pr.base`, `pr.draft`                       | `null`, `false`                                                          | Base branch (`null`: the repository default branch) and draft pull requests            |
| `pr.body_from_run`, `pr.body_sections`      | `true`, `summary, milestones, decisions, review-resolution, follow-ups`  | Build the pull request body from the run artifacts, with these sections                |
| `defaults.models.<role>`                    | see model-selection.md                                                   | Model of each phase subagent (see Phase Subagents)                                     |
| `defaults.interactive`                      | `off`                                                                    | Interactive mode when `--interactive` is not given                                     |

The phase skills read their own sections (`plan`, `build`, `review`, `fix-review`, `await-review`, `merge`, `branch`, `commit`, `worktrees`) through the frozen snapshot.

### Task State

`scripts/go.mjs` owns `<run-dir>/go.json`. Every command takes `--run-dir <path>`:

| Command                                                                    | Use                                                                                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `init --request <text> --base <branch> [--no-pr] [--no-merge] [--worktree] [--max-rounds <n>] [--interactive <mode>] [--reviewers <names>] [--config-snapshot <path>]` | Create the state, resolve the phases, freeze the config. Picks up an `esp-go-light` escalation in the run. A second call prints the state |
| `next`                                                                     | What to run now: `{ action, phase, sub, skill, role, model, effort, cwd, loop, ... }`        |
| `phase <name> --status started\|done\|skipped\|failed [--plan] [--branch] [--base-sha] [--pr] [--summary]` | Record a phase and its facts. `--plan` parses the plan and returns the milestone budget check |
| `worktree --branch <name> [--from <ref>]`                                  | Create the task worktree on a new branch (default from `origin/<base>`), record it as the working directory |
| `pr-loop --after await\|fix`                                               | Pull request rounds: `await`, `fix`, `merge` or `stop`, from the step that just ended        |
| `stop --status awaiting-human\|failed\|halted --reason <text>`             | Record that a phase stopped the task                                                        |
| `halt --key <go.halt_on key> --reason <text>`                              | Log a Halt decision, print the halted block (exit 20)                                       |
| `pr-body [--summary <text>] [--out <file>]`                                | Pull request body from the plan, `state.json`, `decisions.jsonl` and the step results        |
| `result [--status <status>] [--summary <text>]`                            | Final result block from the state and the steps (exits with its contract code)             |

`next` actions: `run` (spawn the phase, see Phase Subagents), `complete` (the internal review loop ended: record `phase review --status done`), `halt` (run `go.mjs halt` with its `key` and `reason`), `stop` (run `go.mjs stop` with its `status` and `reason`), `result` (go to the result). `resumed: true` means the phase was started before an interruption: run it again, the phase skills pick up their own state.

### Phase Subagents

Spawn each phase with the Agent tool, `subagent_type: general-purpose`, with the `model` and `effort` from `next` (omit `model` when it is `inherit`). Record it with `runs.mjs update --model <role>=<model>[:<effort>]`. Run it in the foreground and wait for its reply. The prompt is self-contained:

```markdown
You run one phase of an esp-go task. Read <plugin-root>/skills/<path>/SKILL.md and follow its Instructions as if
invoked with: <arguments>. In that file, ${CLAUDE_PLUGIN_ROOT} means <plugin-root>.
Work in <cwd>. You are a subagent: never ask questions (interactive mode off); wait in the foreground, at most
10 minutes per command, when the skill says to wait in the background.
<extra context>
End with the result line printed by runs.mjs result, copied exactly, as your final line.
```

`<plugin-root>` is the value of `${CLAUDE_PLUGIN_ROOT}` in this session (`echo "${CLAUDE_PLUGIN_ROOT}"`). Every phase skill that takes them gets `--run-dir <run-dir> --config-snapshot <config_snapshot from go.json>`. Pending operator messages go in `<extra context>` as an `## Operator Messages` section (see Operator Messages).

| Phase (`sub`)    | Role (`next.role`) | Skill and arguments                                                                                                   | Extra context and outcome |
| ---------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `plan`           | `planner`          | `esp-plan --interactive off <request>` (`--amend "<feedback>"` after a rejected plan)                                | With `escalated_from`: the escalation reason and `escalation.patch` path, as a starting point the plan may reuse. Then `phase plan --status done --plan <outputs.plan_path>` |
| `branch`         | `mechanical`       | `esp-branch` named from the plan title, from the freshly fetched `origin/<base>`                                      | With `use_worktree`: pick the name per `branch.pattern`, then `go.mjs worktree --branch <name>` instead of a checkout. With `go.json` `branch` already set (escalation): check it out. The subagent records `runs.mjs result branch` with `outputs.branch` and `outputs.base_sha`; then `phase branch --status done --branch <name> --base-sha <sha>` |
| `build`          | `verifier`         | `esp-build --interactive off` (add `--resume` when `next.build_resume`)                                               | The build subagent spawns the builders and verifiers itself (nesting depth 2) |
| `review`         | `reviewer`         | `esp-review --plan <plan_path>` on the task branch vs `origin/<base>`                                                 | The step is `next.loop.step` (`review-<N>`) |
| `review-fix`     | `fixer`            | `esp-fix-review --internal <next.loop.findings_path>`, with `--state <run-dir>/fix-review-<N>.json`                   | Never pushes |
| `pr`             | `mechanical`       | `git push -u origin <branch>`, then `esp-pr --run-dir <run-dir>` (add `--draft` when `next.draft`) with the `go.json` `summary` as the body summary | Then `gh pr ready <url>` when `next.mark_ready`. The subagent records `runs.mjs result pr` with `pr`; then `phase pr --status done --pr <url>` |
| `fix-review`     | `fixer`            | `esp-fix-review --rounds <next.rounds> [--reviewers <names>] <pr url>`                                                | One pull request round per spawn: `--rounds` is the cumulative round number, so it never waits for a re-review itself |
| `merge`          | `fixer`            | `esp-merge <pr url>`                                                                                                  | First refresh the body in this session: `go.mjs pr-body --out <run-dir>/pr-body.md`, then `gh pr edit <url> --body-file <run-dir>/pr-body.md` (with `pr.body_from_run`) |

Before spawning a phase, record `phase <name> --status started`. After it returns, act on its result status: `done` (or `merged` for the merge) records `phase <name> --status done`; `halted` runs `go.mjs stop --status halted --reason <summary>` (the phase logged its Halt decision); `awaiting-human` or `failed` runs `go.mjs stop` with that status, unless Waiting and Open Items says otherwise. A subagent that returns no valid result line counts as `failed` with reason `no result block`.

### The Review Wait and the Pull Request Rounds

`await-review` runs in this session, not in a subagent: its background script wakes this session, and only its result line stays. Follow [esp-await-review](../../github/esp-await-review/SKILL.md) inline (it is a user-only skill: read it, do not invoke it with a skill tool), with `--run-dir`, `--config-snapshot`, `--reviewers` (when given) and the pull request URL. Then:

1. `go.mjs pr-loop --after await`: `fix` spawns the `fix-review` phase (record `phase await-review --status done` the first time); `stop` ends the task (the stop is recorded). With `timed_out: true`, log a B-Decide decision: the comments that arrived are fixed without waiting longer.
2. After each `fix-review` spawn, `go.mjs pr-loop --after fix`: `await` waits again (step 1, then the next `fix-review` spawn with `next.rounds`); `merge` records `phase fix-review --status done`; `stop` ends the task.

### Waiting and Open Items

- A plan that returns `awaiting-human` (open questions): in `plan` or `all` mode, ask, log the answers as operator decisions, and re-run the plan phase with `--amend "<answers>"`. In `off` mode, `go.mjs stop --status awaiting-human`.
- `phase plan --status done --plan` returns `milestones.action: halt`: run `go.mjs halt --key budget`.
- Open pull request review items, or a merge blocked by a condition, end the task with `awaiting-human` and the pull request left open.
- With a caller-owned `--run-dir`, an `awaiting-human` phase ends the skill with that status; the result block passes its `needs_input` through, so the caller can answer and run the skill again with the same `--run-dir`.

### Interactive Checkpoints

Only in `plan` or `all` mode, standalone and not headless. Phase subagents never ask: this session asks, logs each answer with `runs.mjs decision` (`source: operator`), and passes it to the next subagent as an operator message.

| Checkpoint                 | Mode          | Ask                                                                                                          |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| After the plan             | `plan`, `all` | Approve the plan (title, milestones, risks, open questions), or give feedback: re-run the plan with `--amend` |
| Before each internal fix   | `all`         | The findings by class (`by_class` from the review result, details in `findings_path`): fix as recommended, or choose for the B items |
| After each pull request round | `all`      | The round recap (fixed, rejected, deferred): continue, or stop with the pull request open                    |
| Before the merge           | `all`         | Merge now, or stop with the pull request open                                                                |

### Operator Messages

At each phase boundary, read the injected `## Operator Messages` section (first boundary only) and `runs.mjs messages`. Pass the pending messages to the next subagent, then deliver them with `runs.mjs deliver <id>`. A message that says to stop is `go.mjs halt --key scope-change` (or `destructive-action` when it names one). A message that changes the plan re-runs the plan phase with `--amend "<message>"` before the next build.

### Escalation from esp-go-light

`esp-go-light` hands a task over with `/esp-skills:esp-go --run-dir <run-dir>`. `go.mjs init` (no `--request` needed) reads `outputs.escalation` from the `go-light` step: the request, the branch, the base, the files, `escalation.patch` and the stash. It reuses the frozen config snapshot, sets the run back to `running`, and records `escalated_from` in `go.json`. esp-go owns that run. The stash stays in `git stash list` for the user; the planner gets the patch as context, and the summary names both.

## Instructions

1. **Parse arguments**: read the flags and `[context]`. Resolve the interactive mode: the flag, else `defaults.interactive`, `off` when headless. `--resume` without `--run-dir`, or on a run without `go.json`, is a usage error: report it and stop.
2. **Load configuration** (see Configuration).
3. **Preflight**: a git repository with a clean working tree (`git status --porcelain`); with the `pr` phase, `gh auth status` must succeed. Otherwise report it and stop with `status: failed`.
4. **Resolve the run**: with `--run-dir`, use it (`runs.mjs create --run-dir <path>` is a no-op on an existing run). Otherwise `runs.mjs create <slug> --title <task title> --workflow esp-go --repo <owner/name or repo path>`. The run is owned when it was created here or is an escalation hand-off. Resolve the base: `pr.base`, else the repository default branch. Run `go.mjs init --request <request text> --base <base> --project-dir <repo-root>` with the flags that were given (omit `--request` for an escalation hand-off or a resume). A second call prints the state.
5. **Loop**: run `go.mjs next` and act on `action` (see Task State). For `run`, spawn the phase (see Phase Subagents), or run the review wait (see The Review Wait and the Pull Request Rounds). Between phases, handle operator messages and the interactive checkpoints. Loop until `next` returns `result`.
6. **Result**: `go.mjs result` piped into `runs.mjs result go --run-dir <run-dir>`. Pass `--summary` when the default one does not say enough.
7. **Summary and run status**: write `<run-dir>/summary.md` per the summary template (`workflow: esp-go`; `status` is the result status), from the result block and `decisions.jsonl`, and validate it with `runs.mjs validate`. In an owned run, set `runs.mjs update --status` to the result status (`merged`, `done`, `awaiting-human`, `halted`, `failed`). With a caller-owned run, leave both to the caller.
8. **Report** (see Output Guidance), ending with the line printed by `runs.mjs result` as the final output line, copied exactly: never shorten or rewrite it.

## Output Guidance

A short report, then the result block as the final line:

```markdown
### Go: Add OAuth login

- **Plan**: plan.md v1, 3 milestones (approved)
- **Branch**: feature/oauth-login from main
- **Build**: M1 1a2b3c4, M2 5d6e7f8 (2 attempts), M3 9a8b7c6 (gates: test pass, lint pass)
- **Internal review**: 2 rounds; 3 fixed, 1 rejected (D006); clean on round 2
- **PR**: https://github.com/o/r/pull/42; claude reviewed it; 1 round, 2 fixed
- **Merge**: squash (the only method the repository allows); remote branch deleted
- **Summary**: ~/.esp-skills/runs/2026-11-10-oauth-login/summary.md
```

```text
{"contract_version":1,"status":"merged","summary":"Merged \"Add OAuth login\" (3 of 3 milestones): https://github.com/o/r/pull/42 with squash.","files_changed":["src/auth/google.ts","src/routes/login.ts","src/session.ts"],"commit":"9b8e7d6...","pr":"https://github.com/o/r/pull/42","max_risk":"medium","outputs":{"branch":"feature/oauth-login","milestones":["M1","M2","M3"],"milestone_commits":{"M1":"1a2b3c4...","M2":"5d6e7f8...","M3":"9a8b7c6..."},"review_fix_commits":3,"internal_review":{"rounds":2,"max_rounds":2,"remaining":0,"exhausted":false},"merge":{"outcome":"merged","merged":true,"method":"squash"}}}
```

For a halt or `awaiting-human`, name the phase, the blocker, the pull request (left open), and what would unblock it: the next command is `/esp-skills:esp-go --resume --run-dir <run-dir>`.
