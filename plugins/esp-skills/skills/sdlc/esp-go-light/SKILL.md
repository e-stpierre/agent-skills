---
name: esp-go-light
description: Take a small task from request to merged pull request in one session, or escalate to esp-go
argument-hint: "[-s|--stop-before-wait] [-r|--reviewers <name>...] [-i|--interactive <mode>] [-d|--run-dir <path>] [-c|--config-snapshot <path>] [context]"
disable-model-invocation: true
metadata: { af-contract: 1, af-level: recappable }
---

# ESP Go Light

## Overview

The fast track for a small task: one session, no subagents, no plan file. The skill reads the request and the code, creates the branch, implements the change with its tests, runs the gates, makes one commit, pushes, opens the pull request, waits in the background for the bot reviews, fixes them, refreshes the pull request body from the run artifacts, and merges under objective conditions. The result is one commit plus review-fix commits. When the task turns out not to be small (more files than `go-light.max_files_changed`, a design decision, or a second gate failure), it escalates: it saves the work as a patch, stashes it, and ends with `status: escalate` (exit 30) and a result block that `esp-go` picks up. `scripts/go-light.mjs` keeps the phase state, the limits and the hand-off, and the skill writes `summary.md` and `decisions.jsonl` for `esp-recap`.

`context -> branch -> implement -> PR -> await-review -> fix-review -> refresh body -> merge -> summary`, or `escalate` from context or implement

## Arguments

### Definitions

- **`[-s|--stop-before-wait]`** (optional): End after the pull request is open, with a result block. The caller then waits for the reviews, fixes them and merges (for example a harness workflow with its own wait step). No `summary.md` is written: the caller ends the task.
- **`[-r|--reviewers <name>...]`** (optional): Reviewer names from `await-review.reviewers` (`claude`, `codex`) or GitHub logins, repeated (`-r claude -r codex`) or comma-separated. Passed to the review wait and to the review fixes. Defaults to `go.default_reviewers`.
- **`[-i|--interactive <mode>]`** (optional): `off`, `plan` or `all`. `plan` confirms the approach after the context phase, then runs on its own. `all` also stops at the review fixes and before the merge. Defaults to `defaults.interactive` (`off`). Headless sessions always use `off`.
- **`[-d|--run-dir <path>]`** (optional): Run directory owned by a harness or a parent skill. The skill writes its state, decisions and steps there, and leaves `run.json` status to the owner. Without it, the skill creates and owns its run under `runs.root`.
- **`[-c|--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run. Frozen in `go-light.json` on the first call, together with the merged config of an own run.
- **`[context]`** (required unless resuming with `--run-dir`): The task: a short description, a GitHub issue URL or `#<number>`, or a path to a file that describes it.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the classes, the stop conditions and asking under a harness, see [decision-policy.md](../../../references/decision-policy.md)
- For `summary.md`, see [summary-template.md](../../../references/summary-template.md)
- For the run directory commands and exit codes, see [contract-notes.md](../../../references/contract-notes.md)
- The phase skills this skill runs inline: [esp-await-review](../../github/esp-await-review/SKILL.md), [esp-fix-review](../../github/esp-fix-review/SKILL.md), [esp-merge](../../github/esp-merge/SKILL.md)

## Core Principles

- One session, no subagents, no plan file. A task that needs a plan is not a light task: escalate
- Exactly one implementation commit. Gate fixes before the commit go into it; after the commit, only review-fix commits are added
- Escalate early: a file estimate over the limit in the context phase escalates before any code is written
- The scripts decide limits, merges and result blocks. Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path; the scripts are the only writers of `go-light.json`, `run.json`, `decisions.jsonl` and the result files
- A halted task stays unmerged. Push only the task branch; force-push only after a rebase of the task branch; respect branch protection
- Waiting costs no tokens: the review wait and the check wait run as background scripts
- Log each decision when it is made, with `runs.mjs decision`

## Skill-Specific Guidelines

### Configuration

Read the sections once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get go-light
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get go
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get pr
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), stop: the limits and the hand-off need the scripts.

| Key                                    | Default                                                                 | Effect                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `go-light.phases`                      | `context, branch, implement, pr, await-review, fix-review, merge`       | Phases to run. `implement` is required; without `pr`, the wait phases are skipped                                                          |
| `go-light.max_files_changed`           | `10`                                                                    | More changed files (estimated or actual) escalates                                                                                         |
| `go-light.escalate_to_go`              | `true`                                                                  | `false`: no escalation. Over the file limit, continue and log it; design decisions follow the decision policy; a second gate failure halts |
| `go-light.budgets.max_wall_minutes`    | `60`                                                                    | Wall time budget, checked at each phase boundary                                                                                           |
| `go.halt_on`                           | all five stop conditions                                                | Stop conditions honored (see decision-policy.md)                                                                                           |
| `go.default_reviewers`                 | `["claude"]`                                                            | Reviewers to wait for and fix when `--reviewers` is not given                                                                              |
| `pr.base`, `pr.draft`                  | `null`, `false`                                                         | Base branch (`null`: the repository default branch) and draft pull requests                                                                |
| `pr.body_from_run`, `pr.body_sections` | `true`, `summary, milestones, decisions, review-resolution, follow-ups` | Build the pull request body from the run artifacts, with these sections                                                                    |
| `pr.attribution`                       | `true`                                                                  | Append the AI attribution line to the body                                                                                                 |
| `defaults.interactive`                 | `off`                                                                   | Interactive mode when `--interactive` is not given                                                                                         |

The phase skills read their own sections (`await-review`, `fix-review`, `merge`, `commit`) through the frozen snapshot.

### Task State

`scripts/go-light.mjs` owns `<run-dir>/go-light.json`. Every command takes `--run-dir <path>`:

| Command                                                                                                                       | Use                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init --request <text> --base <branch> [--stop-before-wait] [--config-snapshot <path>]`                                       | Create the state, resolve the phases, freeze the config. A second call prints the state                                                                   |
| `phase <name> --status started\|done\|skipped\|failed [--branch] [--base-sha] [--commit] [--pr] [--summary] [--gates <json>]` | Record a phase and its facts (emits `branch.created`, `commit.created`, `pr.opened`, updates `run.json`)                                                  |
| `scope [--estimate <n>]`                                                                                                      | Changed files since the base (tracked and untracked), or a planned count, vs `max_files_changed`. `action`: `continue`, `escalate`, `continue-over-limit` |
| `gate-failure --reason <text>`                                                                                                | Count a gate failure. `action`: `retry`, then `escalate` (or `halt` without escalation) at the second                                                     |
| `budget`                                                                                                                      | Elapsed wall time. `action`: `continue`, `halt` (when `budget` is in `go.halt_on`), `continue-over-budget`                                                |
| `escalate --trigger files\|design\|gates --reason <text> [--question <text>]`                                                 | Save `escalation.patch`, stash the work, log the decision, print the escalate block (exit 30)                                                             |
| `halt --key <go.halt_on key> --reason <text>`                                                                                 | Log a Halt decision, print the halted block (exit 20)                                                                                                     |
| `pr-body [--summary <text>] [--out <file>]`                                                                                   | Pull request body from `decisions.jsonl` and the step results, per `pr.body_sections`                                                                     |
| `result [--status <status>] [--summary <text>]`                                                                               | Final result block from the state and the phase steps (exits with its contract code)                                                                      |

The scripts take long option names only.

### Running Phase Skills Inline

`esp-await-review`, `esp-fix-review` and `esp-merge` are user-only skills, so no skill tool reaches them: read their `SKILL.md` and follow its Instructions in this session, as if invoked with the arguments given in the steps (long option names). Always pass `--run-dir <run-dir>` and `--config-snapshot <snapshot>` (`config_snapshot` from `go-light.json`), so each writes its step (`await-review`, `fix-review`, `merge`) and decisions into this run. Keep only each step's result line.

For `esp-branch` and `esp-commit`, invoke the skill when the runtime has a skill tool, otherwise follow their `SKILL.md`.

### Phase Boundaries

Before each phase from the context phase on:

- Run `go-light.mjs budget`. `action: halt` runs `go-light.mjs halt --key budget`.
- Read the injected `## Operator Messages` section (first boundary only) and `runs.mjs messages`. Apply each message, then deliver it with `runs.mjs deliver <id>`. A message that widens the task is a `design` escalation, and a message that says to stop is `go-light.mjs halt --key scope-change` (or `destructive-action` when it names one).

### Escalation

Escalate (with `go-light.escalate_to_go`) when:

| Trigger  | When                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files`  | `scope --estimate <n>` in the context phase, or `scope` after the gates pass, returns `action: escalate`                                                                                                                   |
| `design` | The request needs a choice that changes scope, a public API, or the data model, or several designs are defensible and the choice matters beyond this change (a B-Scope item, or a B-Decide item with lasting consequences) |
| `gates`  | `gate-failure` returns `action: escalate`: the gates failed twice                                                                                                                                                          |

How to escalate:

1. In `plan` or `all` mode, standalone and not headless: ask first, with "escalate to esp-go" recommended and "continue as a light task" as the alternative (for `design`, offer the design options too). Log the answer with `runs.mjs decision` (`source: operator`). On "continue", go on, and treat the same trigger as answered for the rest of the task.
2. Run `go-light.mjs escalate --trigger <t> --reason <text>` (`--question <text>` for `design`). It saves `<run-dir>/escalation.patch`, stashes the uncommitted work (`git stash list` shows `esp-go-light escalation <run-id>`), and logs the decision. Pipe its output into `runs.mjs result go-light`.
3. Own run: set `runs.mjs update --status halted`, and write `summary.md` with `status: escalate`.
4. Report the hand-off: `/esp-skills:esp-go --run-dir <run-dir>`. esp-go reads `outputs.escalation` from the `go-light` step: the request, the branch, the files, the patch and the stash.

With `escalate_to_go: false`: over the file limit, log a low-risk decision and continue; a design decision follows the decision policy (B-Decide applies the recommendation, B-Scope halts with `scope-change` when it is in `go.halt_on`); a second gate failure halts with `gates-exhausted`.

### Waiting, Open Questions and Halts

A phase step that does not end `done` decides what follows:

- `halted`: stop, with the pull request unmerged, and go to the result and the summary (steps 12 and 13).
- `awaiting-human` with a caller-owned `--run-dir`: end with that status. `result` passes the step's `needs_input` through, so the caller can answer and run the skill again with the same `--run-dir`.
- `awaiting-human` in an own run, `off` mode: apply the autonomous column of the decision policy. A review wait that timed out continues to the review fixes with the comments that arrived (log it as a B-Decide decision). Open review items, or a merge blocked by a condition, end the task with `awaiting-human` and the pull request left open.
- `awaiting-human` in `plan` or `all` mode, not headless: ask, log the answer as an operator decision, and continue.

## Instructions

1. **Parse arguments**: read each option by its short or long name (`-s` or `--stop-before-wait`, `-i all` or `--interactive all`), and the trailing `[context]`. Collect every `-r`/`--reviewers` value into one comma-separated list. Resolve the interactive mode: `-i`/`--interactive`, else `defaults.interactive`, `off` when headless or in a subagent.
2. **Load configuration** (see Configuration).
3. **Check prerequisites**: a git repository whose working tree is clean (`git status --porcelain` prints nothing); with the `pr` phase, `gh auth status` succeeds. Otherwise report it and stop with `status: failed`.
4. **Resolve the run**: with `--run-dir`, use it (`runs.mjs create --run-dir <path>` is a no-op on an existing run). Otherwise `runs.mjs create <slug> --title <task title> --workflow esp-go-light --repo <owner/name or repo path>` and note that the run is owned. Resolve the base: `pr.base`, else the repository default branch. Run `go-light.mjs init --request <request text> --base <base> --project-dir <repo-root>`, with `--stop-before-wait` and `--config-snapshot` when given. A second call on the same run prints the state: continue from the first phase that is not `done` or `skipped`. From here on, cross each phase boundary as Phase Boundaries says.
5. **Context**: `phase context --status started`. Read the request (`gh issue view` for an issue, the file for a path), `AGENTS.md`, and the code the change touches. Decide the approach and list every file to change, tests included. Run `scope --estimate <n>`, and escalate on `action: escalate` (see Escalation), or on a design decision. Small choices are B-Decide: apply the recommended option and log it. In `plan` or `all` mode, show the approach and the files, and continue on approval. Record `phase context --status done --summary "<1-2 sentences: what changes and why>"`.
6. **Branch**: when on the base or the default branch, `git fetch origin <base>`, then create the branch with `esp-branch --slug <slug from the request> --base origin/<base>` (add `--issue <number>` when the request is a GitHub issue). When already on another branch, use it. Without the `branch` phase, the current branch must not be the default branch. Record `phase branch --status done --branch <name> --base-sha <git rev-parse HEAD>`.
7. **Implement**: `phase implement --status started`. Make the change and its tests. Resolve the gates once with `build.mjs gates --project-dir <repo-root>` and run them (gates with source `none` are skipped). When a gate fails, run `gate-failure --reason "<gate>: <first error>"`: on `retry`, fix and run the gates again; on `escalate`, escalate (`gates`); on `halt`, `go-light.mjs halt --key gates-exhausted`. When every gate passes, run `scope`: on `action: escalate`, escalate (`files`). Then make exactly one commit with `esp-commit` (it reads `commit.style`). Record `phase implement --status done --commit <sha> --gates '{"test":"pass",...}'`.
8. **Pull request**: `phase pr --status started`. `git push -u origin <branch>`. Write the body: with `pr.body_from_run`, `go-light.mjs pr-body --out <run-dir>/pr-body.md`; otherwise write it like `esp-pr`. Open it with `gh pr create --base <base> --title "<title>" --body-file <file>` (add `--draft` when `pr.draft`). Record `phase pr --status done --pr <url>`. With `--stop-before-wait`, go to step 12.
9. **Await review**: follow `esp-await-review` inline with `--pr <url>` (add `--reviewers <names>` when given). Act on its status (see Waiting, Open Questions and Halts), then `phase await-review --status done`.
10. **Fix review**: follow `esp-fix-review` inline with `--interactive <mode> --pr <url>` (add `--reviewers <names>` when given). It fixes, pushes, replies and re-waits within `fix-review.max_rounds`. Act on its status, then `phase fix-review --status done`.
11. **Refresh the body and merge**: with `pr.body_from_run`, `go-light.mjs pr-body --out <run-dir>/pr-body.md`, then `gh pr edit <url> --body-file <run-dir>/pr-body.md`. Follow `esp-merge` inline with `--interactive <mode> --pr <url>`. Record `phase merge --status done` when it ended `merged` or `done`.
12. **Result**: `go-light.mjs result` piped into `runs.mjs result go-light --run-dir <run-dir>`. Pass `--summary` when the default one does not say enough.
13. **Summary and run status** (skip both with `--stop-before-wait`): write `<run-dir>/summary.md` per the summary template (`workflow: esp-go-light`; `status` is the result status, `escalate` included) until `runs.mjs validate` passes on it. In an own run, set `runs.mjs update --status` to the result status (`merged`, `done`, `awaiting-human`, `halted`, `failed`; `halted` for an escalation).
14. **Report** (see Output Guidance), ending with the line printed by `runs.mjs result` as the final output line, copied verbatim.

## Output Guidance

A short report, then the result block as the final line:

```markdown
### Go light: Add a --json flag to the status command

- **Branch**: feature/status-json from main
- **Commit**: 4f2a9c1 Add --json flag to the status command (gates: test pass, lint pass)
- **PR**: https://github.com/o/r/pull/42
- **Review**: claude reviewed 4f2a9c1; 2 fixed, 1 rejected (D004); 1 round, 1 review-fix commit
- **Merge**: squash (the only method the repository allows); remote branch deleted
- **Summary**: ~/.esp-skills/runs/2026-11-10-status-json/summary.md
```

```text
{"contract_version":1,"status":"merged","summary":"Merged https://github.com/o/r/pull/42 with squash.","files_changed":["src/status.ts","test/status.test.ts"],"commit":"9b8e7d6...","pr":"https://github.com/o/r/pull/42","gates":{"test":"pass","lint":"pass"},"max_risk":"medium","outputs":{"branch":"feature/status-json","commits":["4f2a9c1...","7d1e0b2..."],"review_fix_commits":1,"merge":{"outcome":"merged","merged":true,"method":"squash"}}}
```

For an escalation, name the trigger and the reason, where the work is (`escalation.patch` and the stash), and the next command: `/esp-skills:esp-go --run-dir <run-dir>`. For a halt or `awaiting-human`, name the blocker, the pull request (left open), and what would unblock it.
