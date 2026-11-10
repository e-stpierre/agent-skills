---
name: esp-build
description: Build a plan milestone by milestone, one verified commit per milestone
argument-hint: "[-u|--resume] [-l|--parallel] [-m|--milestone <id>] [-a|--model <alias>] [-p|--plan <path>] [-i|--interactive <mode>] [-d|--run-dir <path>] [-c|--config-snapshot <path>]"
disable-model-invocation: true
metadata: { af-contract: 1, af-level: recappable }
---

# ESP Build

## Overview

Turn a plan written by `esp-plan` into one commit per milestone. For each milestone, the skill spawns an `esp-builder` subagent that implements it and commits, then an `esp-verifier` subagent that re-runs the gates and checks the acceptance criteria independently. A failed verification retries the builder, which amends the milestone commit; exhausted retries halt the build. Progress lives in `<run-dir>/state.json`, so a build can resume after an interruption, and `--milestone next` runs exactly one milestone per invocation for loop-driven harnesses. The skill keeps only result blocks in its context and ends with a contract result block.

## Arguments

### Definitions

- **`[-u|--resume]`** (optional): Continue an existing build from `state.json` in the run directory. Fails when there is no `state.json`.
- **`[-l|--parallel]`** (optional): Run milestones whose dependencies are done and whose files do not overlap at the same time, each in its own git worktree. Defaults to `build.parallel` (`false`).
- **`[-m|--milestone <id>]`** (optional): Run one milestone and exit. `next` picks the next runnable milestone; an ID such as `M2` runs that milestone if its dependencies are done. Used by loop-driven harness steps.
- **`[-a|--model <alias>]`** (optional): Builder model for every milestone: `opus`, `sonnet`, `haiku` or `fable`. Overrides the complexity-based choice. The verifier keeps its role model.
- **`[-p|--plan <path>]`** (optional): Plan file in plan format 1. Defaults to the latest plan version in the run directory (`runs.mjs plan`).
- **`[-i|--interactive <mode>]`** (optional): `off`, `plan` or `all`. With `all`, show each milestone result and ask before continuing after a failure. Defaults to `defaults.interactive` (`off`). Headless sessions always use `off`.
- **`[-d|--run-dir <path>]`** (optional): Run directory that holds the plan. Without it, the run directory is the directory of `--plan` when that directory has a `run.json`; otherwise the skill creates its own run under `runs.root`.
- **`[-c|--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run. Frozen in `state.json` on the first call.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the plan format and milestone fields, see [plan-format.md](../../../references/plan-format.md)
- For the builder and verifier models, see [model-selection.md](../../../references/model-selection.md)
- For classifying blockers and stop conditions, see [decision-policy.md](../../../references/decision-policy.md)
- For `summary.md`, see [summary-template.md](../../../references/summary-template.md)
- For the run directory commands, see [contract-notes.md](../../../references/contract-notes.md)

## Core Principles

- One milestone is one commit. Retries amend that commit, so the branch carries no fix commits
- A builder's report is never trusted: a milestone is done only when an independent `esp-verifier` run passes
- Keep only result blocks in context. Details (diffs, gate output, decisions) go to the run directory
- Every state change goes through `build.mjs`, and every contract file through `runs.mjs`. `state.json`, `run.json`, `decisions.jsonl` and result files are written by these scripts only
- Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path
- The build only commits: pushing, opening a PR, rebasing and plan changes belong to other skills (plan changes go through `esp-plan --amend`)
- Stop the build at the first halted milestone: later milestones may depend on it

## Skill-Specific Guidelines

### Configuration

Read the settings once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get build
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), stop: the milestone loop needs `build.mjs`.

| Key                               | Default                                                     | Effect                                                                       |
| --------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `build.max_retries_per_milestone` | `2`                                                         | Builder retries after a failed verification before the build halts           |
| `build.parallel`                  | `false`                                                     | Run disjoint milestones in parallel worktrees when `--parallel` is not given |
| `build.commit_per_milestone`      | `true`                                                      | `false` squashes the milestone commits into one commit when the build ends   |
| `build.gates`                     | all `null` (auto-detect)                                    | Gate commands for `test`, `lint`, `typecheck`, `build`                       |
| `defaults.models.builder`         | `low: sonnet`, `medium: opus`, `high: opus` (effort `high`) | Builder model per milestone complexity                                       |
| `defaults.models.verifier`        | `sonnet`                                                    | Verifier model                                                               |
| `defaults.interactive`            | `off`                                                       | Interactive mode when `--interactive` is not given                           |
| `worktrees.root`                  | `~/.esp-skills/worktrees`                                   | Where `--parallel` creates milestone worktrees                               |

`build.mjs init` freezes the merged config in `state.json` (`config_snapshot`), so a resumed build uses the same settings.

### Build State

`scripts/build.mjs` owns `<run-dir>/state.json`. Every command except `gates` takes `--run-dir <path>`:

| Command                                                                        | Use                                                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `init [--plan <file>] [--base <sha>] [--config-snapshot <path>]`               | Create `state.json` from the plan, or sync it with an amended plan (keeps done milestones) |
| `next [--milestone <id\|next>] [--parallel]`                                   | What to do now: `{ action, milestone, batch, attempt, amend, last_failure, reason }`       |
| `start <id> --base <sha>`                                                      | Begin an attempt (counts it, emits `iteration.started`)                                    |
| `finish <id> --status done\|failed\|halted [--commit <sha>] [--reason <text>]` | End the attempt (emits `commit.created` when done, and `iteration.completed`)              |
| `models <id> [--model <alias>]`                                                | Builder and verifier `{ model, effort }` for the milestone                                 |
| `gates --project-dir <repo>`                                                   | Gate commands: `build.gates`, else detected from the project                               |
| `show`                                                                         | Print `state.json`                                                                         |

`next` actions: `run` (first attempt), `retry` (attempt N, `amend` is the commit to amend), `halt` (retries exhausted or a milestone halted), `blocked` (dependencies not done), `done` (nothing left). An attempt that was interrupted (still `in-progress`) comes back as a `retry` and counts as used.

### Run Directory and Contract

esp-build is a recappable skill. With `--run-dir` from a caller, it writes steps and decisions but leaves `run.json` status and `summary.md` to the caller. In its own run (created here, or `--plan` in a run directory nobody else owns), it also sets the run status and writes `summary.md`.

| Moment           | Command                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Own run          | `runs.mjs create <slug> --title <plan title> --workflow esp-build --repo <repo-root>`      |
| Pending messages | `runs.mjs messages`, then `runs.mjs deliver <id>...` once passed to a builder              |
| Decision         | `runs.mjs decision --json '<decision>'` with `phase: build` and the milestone ID in `refs` |
| Models used      | `runs.mjs update --model builder=<alias>[:<effort>] --model verifier=<alias>`              |
| Result block     | `runs.mjs result build --json '<block>'` (or `build-<id>` in `--milestone` mode)           |
| Own run finished | `runs.mjs update --status done`, or `halted` or `failed` to match the result               |

The builder writes `steps/<NN>-build-<id>/result.json` and the verifier `steps/<NN>-verify-<id>/result.json`. A retry reuses both step directories.

### Spawning Subagents

Spawn each subagent with the Agent tool, passing the `model` and `effort` from `build.mjs models <id>` (they override whatever the agent frontmatter sets). Keep each prompt self-contained:

- **Builder** (`esp-skills:esp-builder`): the milestone block from `plan.mjs parse` (ID, title, goal, tasks, files, acceptance criteria, validation), `--run-dir <path>`, step `build-<id>`, the gate commands from `build.mjs gates`, `--config-snapshot <state.config_snapshot>`, and the working directory. On a retry, add the commit to amend (`next.amend`) and the verifier failures (`outputs.failures` and `blockers` of the last `verify-<id>` result). When there are operator messages, add them as an `## Operator Messages` section.
- **Verifier** (`esp-skills:esp-verifier`): the milestone ID, acceptance criteria and validation commands, the expected commit (the builder's `commit`), the base (`start` output), the expected commit count (`1`), the gate commands (the builder's `outputs.gate_commands`, else `build.mjs gates`), `--run-dir <path>` and step `verify-<id>`.

Keep only each subagent's final result line. If a subagent returns no valid result line, treat the attempt as failed with reason `no result block`.

### Parallel Milestones

With `--parallel`, `next` returns a `batch` of runnable milestones whose `files` do not overlap (a milestone without files never runs in parallel). For each milestone in the batch:

1. Create a worktree from the current HEAD: `git worktree add <worktrees.root>/<run-id>-<id> -b <branch>-<id> HEAD`.
2. `build.mjs start <id> --base <HEAD>`, then spawn its builder and verifier in parallel with the other milestones, telling each to work in the worktree path.
3. When every milestone of the batch has a result, integrate the verified ones in plan order: `git cherry-pick <commit>` onto the task branch, then `build.mjs finish <id> --status done --commit <new HEAD>`. When a cherry-pick conflicts, run `git cherry-pick --abort` and finish the milestone as `failed` with reason `conflict with <ids>` and no `--commit`: its retry runs sequentially in the main tree.
4. Finish unverified milestones as `failed` without `--commit` (their commit is not on the task branch), then remove every worktree of the batch (`git worktree remove --force <path>`, `git branch -D <branch>-<id>`).
5. After integrating two or more milestones, run the gate commands once in the main tree. If one fails, halt the build with a Halt decision (`gates-exhausted`): the combination broke what each milestone passed alone.

### Halting

Halt the build (log a Halt decision, write the result block with `status: halted`, stop) when:

- `next` returns `halt`: retries are exhausted. First run `build.mjs finish <id> --status halted --reason <reason>` when the milestone is still `failed`
- A builder returns `halted`, or `awaiting-human` with a blocking `needs_input`: finish the milestone as `halted` and pass its `needs_input` through in the build result block with `status: awaiting-human`
- `next` returns `blocked` outside `--milestone` mode: the plan has a dependency that cannot be satisfied

In `all` mode, ask before halting on exhausted retries: the user can grant one more attempt (log it as an operator decision and re-init with a higher `build.max_retries_per_milestone` in a project config), or stop.

## Instructions

1. **Parse arguments**: read each option by its short or long name (`-u` or `--resume`, `-p` or `--plan`, and so on; `--plan=<path>` works too). Fail with a usage message for an unknown `--model` alias or when `--resume` has no run directory to resume.
2. **Load configuration** (see Configuration) and resolve the interactive mode: the option, else `defaults.interactive`. Use `off` in headless sessions.
3. **Resolve the run directory**: `--run-dir` when given; else the directory of `--plan` when it contains `run.json`; else run `runs.mjs create` with the plan title as slug and use the printed `run_dir` (the plan stays where it is and is passed to `init --plan`). Note whether this is an own run.
4. **Check the tree**: the working tree must be clean (`git status --porcelain`) and on a branch other than the repository default branch. Otherwise stop with `status: failed` and say why: esp-build does not create branches (use `esp-branch`).
5. **Initialize state**: run `build.mjs init --base <git rev-parse HEAD>` with `--plan <file>` when `--plan` was given and `--config-snapshot` when given. With `--resume`, require an existing `state.json` first. `init` is safe to repeat: it keeps done milestones and picks up an amended plan. Parse the plan once with `plan.mjs parse <state.plan_path>` and keep the milestone blocks.
6. **Resolve gates**: run `build.mjs gates --project-dir <repo-root>` once. Gates with source `none` are skipped.
7. **Loop**: run `build.mjs next` (add `--milestone <id>` and `--parallel` when given) and act on `action`:
   - `done`: go to step 8
   - `halt` or `blocked`: follow Halting, then go to step 8
   - `run` or `retry` with a `batch` of two or more: follow Parallel Milestones, then loop
   - `run` or `retry`: continue with step 7a for `milestone`
   1. **Messages**: run `runs.mjs messages`. Pending messages, and any `## Operator Messages` section in the prompt that was not passed on yet, go to this builder.
   2. **Start**: `build.mjs start <id> --base <git rev-parse HEAD>` (on a retry, the base recorded at the first attempt is kept and printed), then `build.mjs models <id>` (with `--model` when given). Record the models with `runs.mjs update --model`.
   3. **Build**: spawn the builder (see Spawning Subagents). Deliver the messages you passed with `runs.mjs deliver`.
   4. **Builder outcome**: `halted` or `awaiting-human`: follow Halting. `failed` with no commit: `build.mjs finish <id> --status failed --reason <first blocker>` and loop.
   5. **Verify**: spawn the verifier with the builder's commit.
   6. **Finish**: verifier `done`: `build.mjs finish <id> --status done --commit <commit>`. Otherwise `build.mjs finish <id> --status failed --commit <commit> --reason <first blocker>`. In `all` mode, show the milestone result before continuing.
   7. With `--milestone`, go to step 8 after one milestone. Otherwise loop.

   The loop is done when `next` returns `done`, `halt` or `blocked`, or after the one milestone of `--milestone` mode, with every attempt closed by `build.mjs finish`.

8. **Squash** (only when `build.commit_per_milestone` is `false` and every milestone is done): `git reset --soft <state.base>` and one commit titled with the plan title, listing the milestones in the body. Log it as a low-risk decision.
9. **Write the result block** with `runs.mjs result <step>`: step `build`, or `build-<id>` with `--milestone`. Fields: `status` (`done` when nothing is left or the requested milestone is done, `failed` after a failed attempt in `--milestone` mode that still has retries, `halted` or `awaiting-human` per Halting), `summary`, `commit` (HEAD), `files_changed` (from `git diff --name-only <state.base>..HEAD`), `gates` (from the last verifier), `max_risk`, `discovered_items` (collected from the builders), and `outputs`: `{ "milestones_done": [...], "milestones_remaining": [...], "commits": { "M1": "<sha>" }, "state_path": "<run-dir>/state.json" }`, plus `milestone` and `attempt` in `--milestone` mode.
10. **Own run only**: write `summary.md` per the summary template, validate it with `runs.mjs validate`, and set the run status (`runs.mjs update --status done|halted|failed`).
11. **Report** (see Output Guidance), ending with the line printed by `runs.mjs result` as the final output line.

## Output Guidance

A short report, then the result block as the final line:

```text
Build of "Add OAuth login" (plan v1): 3 of 3 milestones done

- M1: Add the OAuth provider - 1a2b3c4 (1 attempt)
- M2: Add the login route - 5d6e7f8 (2 attempts: lint fixed)
- M3: Add the session store - 9a8b7c6 (1 attempt)

Gates: test pass, lint pass, typecheck skipped, build pass
Decisions: 3 logged
State: ~/.esp-skills/runs/2026-11-10-add-oauth-login/state.json
{"contract_version":1,"status":"done","summary":"Built 3 of 3 milestones.","commit":"9a8b7c6...","outputs":{"milestones_done":["M1","M2","M3"],"milestones_remaining":[]}}
```

For a halt, name the milestone, the attempts, the last failure, and the next step (`esp-plan --amend --run-dir <path>`, or `esp-build --resume` after a fix).
