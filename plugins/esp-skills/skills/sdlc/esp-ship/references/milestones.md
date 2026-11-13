# Milestone Loop

The `build` phase of the orchestrated track. `ship.mjs next` returns `phase: build` with `milestone_loop: true`, `plan_path` and `build_resume`. This session runs the loop itself: for each milestone it spawns an `esp-skills:esp-builder` that implements it and commits, then an `esp-skills:esp-verifier` that re-runs the gates and checks the acceptance criteria independently. A failed verification retries the builder, which amends the milestone commit. Exhausted retries halt the build. Every command below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/ship.mjs" milestone <cmd> --run-dir <run-dir>`.

## Setup

1. `phase build --status started`.
2. `milestone init --base <git rev-parse HEAD>` (in the working directory `cwd` from `next`). It creates `state.json` from the plan, or syncs it with an amended plan and keeps the done milestones. It is safe to repeat, so a resume runs it too. Its `parallel` output (`mode`, `enabled`, `reason`, `max_parallel`, `worktrees_root`, `batches`) says whether `next` returns parallel batches: `ship.parallel` `on` or `off` is taken as is, and `auto` (the default) is on only when the plan has a batch of two or more milestones with disjoint files and `worktrees.root` is usable. Log it once as a low-risk `policy` decision (`Build in parallel batches` or `Build one milestone at a time`, with the reason).
3. Parse the plan once with `node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" parse <plan_path>` and keep the milestone blocks.
4. `milestone gates --project-dir <cwd>` once for the full gates, then `milestone gates --milestone <id> --project-dir <cwd>` for each milestone: its `commands` are the scoped checks of its builder and verifier (see gates.md).

## Loop

Run `milestone next` (add `--parallel` when the skill got `--parallel`: it forces batches even when `milestone init` resolved them off) and act on `action`:

- **`done`**: every milestone is done. Go to Wrap Up
- **`halt`** or **`blocked`**: follow Halting
- **`run`** or **`retry`** with a `batch` of two or more: follow Parallel Batches, then loop
- **`run`** or **`retry`**: build `milestone` with the steps below, then loop

For one milestone:

1. **Messages**: `runs.mjs messages`. Pending messages, and any `## Operator Messages` section not passed on yet, go to this builder.
2. **Start**: `milestone start <id> --base <git rev-parse HEAD>` (a retry keeps and prints the base of the first attempt), then `milestone models <id>` (with `--model <alias>` when `--model` was given). Record the models with `runs.mjs update --model builder=<alias>[:<effort>] --model verifier=<alias>`.
3. **Build**: `milestone reuse <id>` decides whether the last builder continues (see Builder Reuse). On `reuse`, continue that builder. On `fresh`, spawn a new one (see Spawning). Then record the builder with `milestone agent <id> --agent-id <agentId> --tokens <subagent_tokens>`, both taken from the Agent result. Deliver the messages you passed with `runs.mjs deliver <id>`.
4. **Builder outcome**: `halted` or `awaiting-human` follows Halting. `failed` with no commit runs `milestone finish <id> --status failed --reason <first blocker>`, then loop.
5. **Verify**: spawn the verifier with the builder's commit.
6. **Finish**: verifier `done` runs `milestone finish <id> --status done --commit <commit>`. Otherwise `milestone finish <id> --status failed --commit <commit> --reason <first blocker>`. In `all` mode, show the milestone result before continuing.

An attempt interrupted while `in-progress` comes back from `next` as a `retry` and counts as used.

## Spawning

Verifiers are always fresh. Spawn each subagent with the Agent tool, with the `model` and `effort` from `milestone models <id>` (they override the agent frontmatter), in the foreground. Keep each prompt self-contained, and keep only each final result line. A subagent that returns no valid result line is a failed attempt with reason `no result block`.

- **Builder** (`esp-skills:esp-builder`): the milestone block from `plan.mjs parse` (ID, title, goal, tasks, files, acceptance criteria, validation), `--run-dir <run-dir>`, step `build-<id>`, the scoped gate commands of the milestone (`commands` from `milestone gates --milestone <id>`), `--config-snapshot <state.config_snapshot>`, and the working directory. On a retry, add the commit to amend (`next.amend`) and the verifier failures (`outputs.failures` and `blockers` of the last `verify-<id>` result). Add pending operator messages as an `## Operator Messages` section
- **Verifier** (`esp-skills:esp-verifier`): the milestone ID, the acceptance criteria and the validation commands, the expected commit (the builder's `commit`), the base (from `milestone start`), the expected commit count (`1`), the gate commands (the builder's `outputs.gate_commands`, else the scoped commands of the milestone), `--run-dir <run-dir>` and step `verify-<id>`

The builder writes `steps/<NN>-build-<id>/result.json` and the verifier `steps/<NN>-verify-<id>/result.json`. A retry reuses both step directories.

## Builder Reuse

A builder that just built a related milestone already knows the code, so it continues with the next one instead of a fresh builder rediscovering it. `milestone reuse <id>` decides it deterministically and logs a `policy` decision. Pass `--agent-id <id>` with the agent ID of the last builder this session spawned or continued. Omit it when this session holds none, for example after a resume. Add `--model` and `--effort` when `--model` was given, and `--single` in Single Milestone Mode. It returns `decision: reuse` with the `agent_id` to continue only when every rule holds:

- **Relevance**: the milestone is a retry of the builder's last milestone, or it depends on or shares files with a milestone that builder ran
- **Model**: the builder model and effort of the milestone (`milestone models <id>`) equal the builder's
- **Budget**: `used + cost <= ship.reuse.limit_tokens` (default `250000`). `cost` is `ship.reuse.cost.<complexity>` of the milestone (`low` `40000`, `medium` `70000`, `high` `120000`). `used` is the last `--tokens` recorded with `milestone agent`, else the sum of the costs of the work the builder ran
- **Always fresh**: a parallel batch, a builder that ran in a worktree, Single Milestone Mode, and a missing or different agent ID start fresh, with the reason logged

To continue a builder, send it the input a fresh builder would get with SendMessage to `agent_id`: the milestone block, its step, its scoped gate commands and its messages. On a retry, send the commit to amend and the verifier failures. The continued builder runs in the background: wait for its task notification, then read its result from `steps/<NN>-build-<id>/result.json`, because its reply may not come back as a report. When the send fails or no result file appears, the agent is lost: spawn a fresh builder and record that one. Fresh builders get what earlier builders learned from the run notes (`notes.md`), which they read themselves.

## Parallel Batches

`next` returns a `batch` of at most `ship.max_parallel` (default `3`) runnable milestones whose `files` do not overlap. A milestone without files, or whose files cover the whole repository, never runs in a batch. Batches never run in Single Milestone Mode. For a batch:

1. **Worktrees**: for each milestone, create a worktree from the current HEAD: `git worktree add <worktrees_root>/<run-id>-<id> -b <branch>-<id> HEAD` (`worktrees_root` from `milestone init`).
2. **Build and verify**: `milestone start <id> --base <HEAD>` for each milestone, then spawn every builder at once (several Agent calls in one message), each told to work in its worktree path. Record each one with `milestone agent <id> --agent-id <agentId> --worktree`: a batch builder is never continued. Spawn each verifier, in the same worktree, as soon as its builder returns a commit.
3. **Integrate**: when every milestone of the batch has a result, take the verified ones in plan order: `git cherry-pick <commit>` onto the task branch in the main tree, then `milestone finish <id> --status done --commit <new HEAD>`. When a cherry-pick conflicts, run `git cherry-pick --abort` and `milestone finish <id> --status failed --reason "conflict with <ids>"` with no `--commit`: `next` then returns it as a `retry` with a batch of one, which runs sequentially in the main tree from the new HEAD.
4. **Unverified**: finish each milestone whose verifier failed as `failed`, without `--commit` (its commit is not on the task branch). Its retry also runs sequentially.
5. **Clean up**: remove every worktree of the batch (`git worktree remove --force <path>`) and its branch (`git branch -D <branch>-<id>`), even after a failure.
6. **Combined gates**: after integrating two or more milestones, run `milestone gates --files <files of the integrated milestones>` once in the main tree and run its `commands`. If one fails, halt the build with a Halt decision (`gates-exhausted`): the combination broke what each milestone passed alone. The full gates still run once in the `final-gates` phase.

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
2. Run Setup steps 2 to 4 (`milestone init` also takes `--config-snapshot` when given). The builder is always fresh: pass `--single` to `milestone reuse`.
3. `milestone next --milestone <id|next>` and act on it as in Loop, for one milestone only. `done` means nothing is left. `blocked` means the requested milestone's dependencies are not done: report it with `status: failed`.
4. Write the result block with `runs.mjs result build-<id> --run-dir <run-dir> --json '<block>'`: `status` (`done` when the milestone is done or nothing is left, `failed` after a failed attempt that still has retries, `halted` or `awaiting-human` per Halting), `summary`, `commit` (HEAD), `files_changed` (`git diff --name-only <state.base>..HEAD`), `gates` (from the verifier), `max_risk`, `discovered_items` (from the builder), and `outputs`: `{ "milestone": "<id>", "attempt": <n>, "milestones_done": [...], "milestones_remaining": [...], "commits": { "<id>": "<sha>" }, "state_path": "<run-dir>/state.json" }`.
5. Report the milestone result and end with the line printed by `runs.mjs result`. The caller writes `summary.md` and sets the run status.
