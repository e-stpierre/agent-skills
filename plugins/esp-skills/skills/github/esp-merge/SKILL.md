---
name: esp-merge
description: Merge a pull request under objective conditions, with the method the repository allows
argument-hint: "[-n|--dry-run] [-m|--method <method>] [-i|--interactive <mode>] [-p|--pr <pr>] [-d|--run-dir <path>] [-c|--config-snapshot <path>]"
disable-model-invocation: true
metadata: { af-contract: 1, af-level: reporting }
---

# ESP Merge

## Overview

Merge a pull request only when objective conditions hold, and with the merge method the repository allows. `scripts/merge-ready.mjs` checks every condition (no halt recorded, checks green, review threads resolved, not a draft, no changes requested, up to date with the base, branch protection satisfied) and resolves the method from the repository settings, rulesets and merge queue. The skill acts on the outcome: it rebases a branch that is behind and checks again, waits in the background for pending checks, and otherwise merges, or reports why it did not. Unmet branch protection ends `awaiting-human` and is never bypassed. The method and the reason are logged as a decision, and the remote branch and the task worktree are cleaned up per config.

## Arguments

### Definitions

Read each option by its short or its long name (`-m squash`, `--method squash` or `--method=squash`).

- **`[-n|--dry-run]`** (optional): Check the conditions and resolve the method, rebase nothing, merge nothing. The result block reports what would happen.
- **`[-m|--method <method>]`** (optional): `repo`, `squash`, `rebase` or `merge`. Defaults to `merge.method` (`repo`: pick from what the repository allows). An explicit method the repository does not allow is an error, never a silent fallback.
- **`[-i|--interactive <mode>]`** (optional): `off`, `plan` or `all`. Only `all` stops for a confirmation before merging. Defaults to `defaults.interactive` (`off`). Headless sessions always use `off`.
- **`[-p|--pr <pr>]`** (optional): Pull request number, `#<number>`, or URL. Defaults to the pull request of the current branch.
- **`[-d|--run-dir <path>]`** (optional): Run directory owned by a harness or a parent skill. Halt decisions and the run status count as halt signals, the method decision and the merge events go to the run, and the result block is recorded as step `merge`. Without it, no run is created.
- **`[-c|--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run, passed to every script call.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the Halt class and the `ship.halt_on` stop conditions, see [decision-policy.md](../../../references/decision-policy.md)
- For the background wait pattern, see [esp-fix-review](../esp-fix-review/SKILL.md) (Waiting for Reviews and Checks)
- For how the script resolves the method and holds the harness merge lock, see [merge-script.md](references/merge-script.md)
- For the result block and exit codes, see [contract-notes.md](../../../references/contract-notes.md)

## Core Principles

- The script decides whether a pull request may merge, never the model. Every merge goes through `merge-ready.mjs merge`, the only merge command
- Unmet branch protection ends `awaiting-human`. Hard guardrail: no `--admin`, no disabling rules, no dismissing reviews
- A halted task never merges. A Halt decision in the run blocks the merge until an operator decision references it
- The only force-push is `git push --force-with-lease` of the pull request's own head branch, right after a rebase. The base branch is never pushed
- Re-run the gates after every rebase, and push only a rebase whose gates pass
- The script waits, the session sleeps: wait for checks with the script in the background, never with polling or `sleep` loops in the session
- Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path. The result block always comes from the script
- The merge lock (`AF_MERGE_LOCK`) belongs to the harness and `merge-ready.mjs merge`: the skill never creates or removes it

## Skill-Specific Guidelines

### Configuration

Read the sections once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get merge
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get worktrees
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), stop: the merge conditions need the script.

- `merge.enabled` (default `true`): `false` reports and leaves the pull request open
- `merge.method` (default `repo`): `repo` resolves the method from the repository, else force one method
- `merge.preference` (default `["squash", "rebase", "merge"]`): order used when the repository allows several methods
- `merge.delete_branch` (default `true`): delete the remote head branch after the merge (never a fork branch)
- `merge.require_resolved_threads` (default `true`): unresolved review threads block the merge
- `merge.require_green_checks` (default `true`): every check must pass. `false`: only the required checks
- `merge.use_auto_merge` (default `false`): with checks pending, enable GitHub auto-merge instead of waiting
- `merge.checks_timeout_minutes` (default `30`): wait for pending checks, and for a busy merge lock
- `worktrees.root`, `worktrees.cleanup` (defaults `~/.esp-skills/worktrees`, `on-merge`): remove the task worktree after the merge, unless cleanup is `never`
- `defaults.interactive` (default `off`): interactive mode when `--interactive` is not given

### Scripts

Every `merge-ready.mjs` call takes the `--pr` value as `<pr>` (omitted without it), plus `--run-dir <path>` and `--config-snapshot <path>` when given:

- **Check**: `merge-ready.mjs check [<pr>] [--method <m>]` (report: `ready`, `outcome`, `conditions`, `method`)
- **Wait for checks**: `merge-ready.mjs check [<pr>] --wait` (polls every 30 s up to `checks_timeout_minutes`)
- **Merge**: `merge-ready.mjs merge [<pr>] [--method <m>] [--dry-run]` (result block)
- **Halt**: `merge-ready.mjs merge [<pr>] --halt "<reason>"` (logs a Halt decision, never merges)
- **Gates after rebase**: `ship.mjs milestone gates --project-dir <repo>` prints the gate commands (configured or detected); run each

Each condition in the report is `pass`, `fail` or `pending`, with a reason. The outcomes:

- `ready`: every condition passes and a method is allowed. Merge
- `pending`: only checks are still running. Wait for checks, then check again
- `behind`: the branch is behind the base. Rebase, then check again
- `conflict`: the branch conflicts with the base. Rebase and resolve, or halt
- `blocked`: draft, changes requested, unresolved threads, failing checks, or no method. Merge reports it (`awaiting-human`)
- `protected`: branch protection or rulesets block the merge (for example a required approval). Merge reports it (`awaiting-human`)
- `halted`: the run is halted, or a Halt decision is not lifted. Merge reports it (`halted`)
- `queued`: already in the merge queue, or auto-merge already on. Merge reports it (`done`)
- `merged`, `closed`: nothing left to merge. Merge reports it

### Rebase and Re-Check

When the outcome is `behind` or `conflict`, and the pull request is not from a fork:

1. The working tree must be clean and on the pull request head branch (`gh pr checkout <pr>` otherwise; in a worktree, work there).
2. `git fetch origin <base>`, then `git rebase origin/<base>`.
3. On conflicts: resolve them only when both sides are clear (for example a changelog or a lockfile, or independent edits) and you can explain the result. Otherwise `git rebase --abort`, then `merge-ready.mjs merge --halt "rebase conflict with <base> in <files>"`, and go to the report.
4. Run every gate command that `ship.mjs milestone gates` prints. If a gate fails because of the rebase and you cannot fix it in the rebased commits, halt the same way with the failing gate as the reason.
5. `git push --force-with-lease`, then wait for the checks of the new head (see Waiting for Checks) and check again.

Rebase at most 3 times per invocation: a base that keeps moving ends with the `behind` outcome of the last check. A fork pull request is never rebased: the merge reports `behind` or `conflict`.

### Waiting for Checks

Run `merge-ready.mjs check [<pr>] --wait` like `esp-fix-review` runs its wait: in the background with an exit notification when the runtime has it (end the turn; the next action is reading the exit notification), else in the foreground with the longest shell timeout. It exits when the outcome is no longer `pending`, or with `timed_out: true`. With `merge.use_auto_merge`, skip the wait: `merge` enables auto-merge on pending checks.

### Interactive Merge

In `all` mode, standalone and not headless: before the merge, show the conditions and the method with its reason, and ask whether to merge. On "no", leave the pull request open: run `merge-ready.mjs merge --dry-run` for the result block, and with `--run-dir` log the answer with `runs.mjs decision` (`source: operator`, `phase: merge`). In every other mode, merge without asking.

### Local Cleanup

After `outputs.merged` is `true`:

- `outputs.cleanup.worktree.remove` is `true`: leave the worktree (`cd` to `outputs.cleanup.worktree.main`), then `git worktree remove <path>`, without `--force`: a dirty worktree is kept and reported.
- Otherwise, when the current branch is the merged head branch and `merge.delete_branch` is on: `git switch <base>`, `git pull --ff-only`, then `git branch -D <branch>` (the merge on GitHub is confirmed, so a squash or rebase merge does not lose work).

## Instructions

1. **Parse arguments**: read every option by its short or long name. Resolve the interactive mode (`-i|--interactive`, else `defaults.interactive`, `off` when headless).
2. **Load configuration** (see Configuration). With `merge.enabled: false`, skip to step 8: `merge` reports it, with no confirmation.
3. **Check prerequisites**: `gh auth status` must succeed, and the pull request must exist. Otherwise report it and stop.
4. **Read operator messages**: with `--run-dir`, the injected `## Operator Messages` section and `runs.mjs messages`. A message that says not to merge ends the skill with `merge --halt "<message>"`. Deliver applied messages with `runs.mjs deliver`.
5. **Check**: `merge-ready.mjs check [<pr>] [--method <m>]`. With `--dry-run`, skip to step 8, with no confirmation.
6. **Act on the outcome** (see Scripts): `pending` -> wait for checks and check again; `behind` or `conflict` -> rebase and re-check (see Rebase and Re-Check). Repeat until the outcome is neither `pending`, `behind` nor `conflict`, or the rebase limit is reached.
7. **Confirm** (`all` mode only, see Interactive Merge). Only a merge that will happen is confirmed.
8. **Merge**: `merge-ready.mjs merge [<pr>] [--method <m>] [--dry-run]`. With `--run-dir`, pipe it into `runs.mjs result merge --run-dir <path>`, which records the step and prints the result line. The script re-checks under the merge lock, so a base that moved since step 6 ends `behind` without merging.
9. **Clean up** (see Local Cleanup) when the pull request merged.
10. **Report** (see Output Guidance), then the result line as the final output line.

## Output Guidance

A short status with each condition, then the result block as the final line:

```markdown
### Merge: PR 42

- **Conditions**: open, no halt, not a draft, no changes requested, threads resolved, 4 checks green, up to date with main, protection satisfied
- **Method**: squash (first allowed method in merge.preference [squash, rebase, merge])
- **Rebased**: once, onto main at 7c1e2d3, gates passed
- **Cleanup**: remote branch deleted, worktree removed
```

```text
{"contract_version":1,"status":"merged","summary":"Merged #42 at 9b8e7d6 with squash (first allowed method in merge.preference [squash, rebase, merge]).","max_risk":"low","pr":"https://github.com/o/r/pull/42","outputs":{"pr":42,"outcome":"merged","merged":true,"method":"squash","method_reason":"first allowed method in merge.preference [squash, rebase, merge]","queue":false,"head":"9b8e7d6...","base":"main","conditions":{"open":"pass","halt":"pass","draft":"pass","changes-requested":"pass","threads":"pass","checks":"pass","up-to-date":"pass","branch-protection":"pass"},"failing":[],"decision":"D007","cleanup":{"remote_branch":"deleted","worktree":{"path":null,"remove":false,"reason":"not a linked worktree"}}}}
```

`status` is `merged` after a merge, `done` when the pull request was queued, set to auto-merge, left open by config or `--dry-run`, `awaiting-human` when a condition is unmet (with a blocking `needs_input` under `--run-dir`: check again or leave open), `halted` when a halt blocks it, and `failed` when the pull request is closed.
