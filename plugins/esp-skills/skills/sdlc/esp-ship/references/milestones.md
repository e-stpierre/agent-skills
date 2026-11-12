# Milestone Loop

The `build` phase of the orchestrated track. `ship.mjs next` returns `phase: build` with `milestone_loop: true`, `plan_path` and `build_resume`. This session runs the loop itself: for each milestone it spawns an `esp-skills:esp-builder` that implements it and commits, then an `esp-skills:esp-verifier` that re-runs the gates and checks the acceptance criteria independently. A failed verification retries the builder, which amends the milestone commit. Exhausted retries halt the build. Every command below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/ship.mjs" milestone <cmd> --run-dir <run-dir>`.

## Setup

1. `phase build --status started`.
2. `milestone init --base <git rev-parse HEAD>` (in the working directory `cwd` from `next`). It creates `state.json` from the plan, or syncs it with an amended plan and keeps the done milestones. It is safe to repeat, so a resume runs it too.
3. Parse the plan once with `node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" parse <plan_path>` and keep the milestone blocks.
4. `milestone gates --project-dir <cwd>` once (see gates.md).

## Loop

Run `milestone next` (add `--parallel` with `--parallel`, or when `ship.parallel` is `on`) and act on `action`:

- **`done`**: every milestone is done. Go to Wrap Up
- **`halt`** or **`blocked`**: follow Halting
- **`run`** or **`retry`** with a `batch` of two or more: follow Parallel Batches, then loop
- **`run`** or **`retry`**: build `milestone` with the steps below, then loop

For one milestone:

1. **Messages**: `runs.mjs messages`. Pending messages, and any `## Operator Messages` section not passed on yet, go to this builder.
2. **Start**: `milestone start <id> --base <git rev-parse HEAD>` (a retry keeps and prints the base of the first attempt), then `milestone models <id>` (with `--model <alias>` when `--model` was given). Record the models with `runs.mjs update --model builder=<alias>[:<effort>] --model verifier=<alias>`.
3. **Build**: spawn the builder (see Spawning). Deliver the messages you passed with `runs.mjs deliver <id>`.
4. **Builder outcome**: `halted` or `awaiting-human` follows Halting. `failed` with no commit runs `milestone finish <id> --status failed --reason <first blocker>`, then loop.
5. **Verify**: spawn the verifier with the builder's commit.
6. **Finish**: verifier `done` runs `milestone finish <id> --status done --commit <commit>`. Otherwise `milestone finish <id> --status failed --commit <commit> --reason <first blocker>`. In `all` mode, show the milestone result before continuing.

An attempt interrupted while `in-progress` comes back from `next` as a `retry` and counts as used.

## Spawning

Spawn each subagent with the Agent tool, with the `model` and `effort` from `milestone models <id>` (they override the agent frontmatter), in the foreground. Keep each prompt self-contained, and keep only each final result line. A subagent that returns no valid result line is a failed attempt with reason `no result block`.

- **Builder** (`esp-skills:esp-builder`): the milestone block from `plan.mjs parse` (ID, title, goal, tasks, files, acceptance criteria, validation), `--run-dir <run-dir>`, step `build-<id>`, the gate commands, `--config-snapshot <state.config_snapshot>`, and the working directory. On a retry, add the commit to amend (`next.amend`) and the verifier failures (`outputs.failures` and `blockers` of the last `verify-<id>` result). Add pending operator messages as an `## Operator Messages` section
- **Verifier** (`esp-skills:esp-verifier`): the milestone ID, the acceptance criteria and the validation commands, the expected commit (the builder's `commit`), the base (from `milestone start`), the expected commit count (`1`), the gate commands (the builder's `outputs.gate_commands`, else the resolved gates), `--run-dir <run-dir>` and step `verify-<id>`

The builder writes `steps/<NN>-build-<id>/result.json` and the verifier `steps/<NN>-verify-<id>/result.json`. A retry reuses both step directories.

## Parallel Batches

`next` returns a `batch` of runnable milestones whose `files` do not overlap (a milestone without files never runs in parallel). For each milestone of the batch:

1. Create a worktree from the current HEAD: `git worktree add <worktrees.root>/<run-id>-<id> -b <branch>-<id> HEAD`.
2. `milestone start <id> --base <HEAD>`, then spawn its builder and its verifier, in parallel with the other milestones of the batch, telling each to work in the worktree path.
3. When every milestone of the batch has a result, integrate the verified ones in plan order: `git cherry-pick <commit>` onto the task branch, then `milestone finish <id> --status done --commit <new HEAD>`. When a cherry-pick conflicts, run `git cherry-pick --abort` and finish the milestone as `failed` with reason `conflict with <ids>` and no `--commit`: its retry runs sequentially in the main tree.
4. Finish the unverified milestones as `failed` without `--commit` (their commit is not on the task branch), then remove every worktree of the batch (`git worktree remove --force <path>`, `git branch -D <branch>-<id>`).
5. After integrating two or more milestones, run the gate commands once in the main tree. If one fails, halt the build with a Halt decision (`gates-exhausted`): the combination broke what each milestone passed alone.

## Halting

Halt the build (log a Halt decision with `phase: build` and the milestone ID in `refs`, then stop the loop) when:

- `next` returns `halt`: retries are exhausted. First run `milestone finish <id> --status halted --reason <reason>` when the milestone is still `failed`
- A builder returns `halted`, or `awaiting-human` with a blocking `needs_input`: finish the milestone as `halted`, and pass its `needs_input` on
- `next` returns `blocked` outside `--milestone` mode: the plan has a dependency that cannot be satisfied

Then `ship.mjs halt --key gates-exhausted --reason <reason>` for exhausted retries or a broken combination, or `ship.mjs stop --status awaiting-human|halted --reason <reason>` for a builder that stopped. In `all` mode, ask before halting on exhausted retries: the user can grant one more attempt (log it as an operator decision and run `milestone init` again with a higher `ship.max_retries_per_milestone` in a project config), or stop.

## Wrap Up

1. **Squash** (only when `ship.commit_per_milestone` is `false` and every milestone is done): `git reset --soft <state.base>` and one commit titled with the plan title, listing the milestones in the body. Log it as a low-risk decision.
2. `phase build --status done`, then back to the loop of SKILL.md.

## Single Milestone Mode

`--milestone next|<id>` builds one milestone of the plan in `--run-dir` and exits, for a harness that loops over the milestones. It needs no `ship.json`: the caller owns the run and the branch.

1. The working tree is clean and on a branch other than the repository default branch. Otherwise stop with `status: failed`: this mode creates no branch.
2. Run Setup steps 2 to 4 (`milestone init` also takes `--config-snapshot` when given).
3. `milestone next --milestone <id|next>` and act on it as in Loop, for one milestone only. `done` means nothing is left. `blocked` means the requested milestone's dependencies are not done: report it with `status: failed`.
4. Write the result block with `runs.mjs result build-<id> --run-dir <run-dir> --json '<block>'`: `status` (`done` when the milestone is done or nothing is left, `failed` after a failed attempt that still has retries, `halted` or `awaiting-human` per Halting), `summary`, `commit` (HEAD), `files_changed` (`git diff --name-only <state.base>..HEAD`), `gates` (from the verifier), `max_risk`, `discovered_items` (from the builder), and `outputs`: `{ "milestone": "<id>", "attempt": <n>, "milestones_done": [...], "milestones_remaining": [...], "commits": { "<id>": "<sha>" }, "state_path": "<run-dir>/state.json" }`.
5. Report the milestone result and end with the line printed by `runs.mjs result`. The caller writes `summary.md` and sets the run status.
