---
name: esp-merge
description: Merge a pull request under objective conditions, with the method the repository allows
argument-hint: "[--dry-run] [--method <method>] [--interactive <mode>] [--run-dir <path>] [--config-snapshot <path>] [pr]"
disable-model-invocation: true
metadata: { af-contract: 1, af-level: reporting }
---

# ESP Merge

## Overview

Merge a pull request only when objective conditions hold, and with the merge method the repository allows. `scripts/merge-ready.mjs` checks every condition (no halt recorded, checks green, review threads resolved, not a draft, no changes requested, up to date with the base, branch protection satisfied) and resolves the method from the repository settings, rulesets and merge queue. The skill acts on the outcome: it rebases a branch that is behind and checks again, waits in the background for pending checks, and otherwise merges, or reports why it did not. Unmet branch protection ends `awaiting-human` and is never bypassed. The method and the reason are logged as a decision, and the remote branch and the task worktree are cleaned up per config.

## Arguments

### Definitions

- **`[--dry-run]`** (optional): Check the conditions and resolve the method, rebase nothing, merge nothing. The result block reports what would happen.
- **`[--method <method>]`** (optional): `repo`, `squash`, `rebase` or `merge`. Defaults to `merge.method` (`repo`: pick from what the repository allows). An explicit method the repository does not allow is an error, never a silent fallback.
- **`[--interactive <mode>]`** (optional): `off`, `plan` or `all`. Only `all` stops for a confirmation before merging. `--interactive=<mode>` also works. Defaults to `defaults.interactive` (`off`). Headless sessions always use `off`.
- **`[--run-dir <path>]`** (optional): Run directory owned by a harness or a parent skill. Halt decisions and the run status count as halt signals, the method decision and the merge events go to the run, and the result block is recorded as step `merge`. Without it, no run is created.
- **`[--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run, passed to every script call.
- **`[pr]`** (optional): Pull request number, `#<number>`, or URL. Defaults to the pull request of the current branch.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the Halt class and the `go.halt_on` stop conditions, see [decision-policy.md](../../../references/decision-policy.md)
- For the background wait pattern, see [esp-await-review](../esp-await-review/SKILL.md)
- For the result block and exit codes, see [contract-notes.md](../../../references/contract-notes.md)

## Core Principles

- The script decides whether a pull request may merge, never the model. Merge only through `merge-ready.mjs merge`, never with `gh pr merge` by hand
- Never bypass branch protection: no `--admin`, no disabling rules, no dismissing reviews. Unmet protection ends `awaiting-human`
- A halted task never merges. A Halt decision in the run blocks the merge until an operator decision references it
- Force-push only the pull request's own head branch, only after a rebase, and only with `--force-with-lease`. Never push to the base branch
- Re-run the gates after every rebase. Do not push a rebase whose gates fail
- Waiting never burns tokens: wait for checks with the script in the background, never with polling or `sleep` loops in the session
- Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path. Never build the result block by hand

## Skill-Specific Guidelines

### Configuration

Read the sections once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get merge
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get worktrees
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), stop: the merge conditions need the script.

| Key                                   | Default                               | Effect                                                                |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `merge.enabled`                       | `true`                                | `false`: report and leave the pull request open                       |
| `merge.method`                        | `repo`                                | `repo` resolves the method from the repository, else force one method |
| `merge.preference`                    | `["squash", "rebase", "merge"]`       | Order used when the repository allows several methods                 |
| `merge.delete_branch`                 | `true`                                | Delete the remote head branch after the merge (never a fork branch)   |
| `merge.require_resolved_threads`      | `true`                                | Unresolved review threads block the merge                             |
| `merge.require_green_checks`          | `true`                                | Every check must pass. `false`: only the required checks              |
| `merge.use_auto_merge`                | `false`                               | With checks pending, enable GitHub auto-merge instead of waiting      |
| `merge.checks_timeout_minutes`        | `30`                                  | Wait for pending checks, and for a busy merge lock                    |
| `worktrees.root`, `worktrees.cleanup` | `~/.esp-skills/worktrees`, `on-merge` | Remove the task worktree after the merge, unless cleanup is `never`   |
| `defaults.interactive`                | `off`                                 | Interactive mode when `--interactive` is not given                    |

### Scripts

Every call takes `[pr]`, plus `--run-dir <path>` and `--config-snapshot <path>` when given:

| Moment             | Command                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Check              | `merge-ready.mjs check [pr] [--method <m>]` (report: `ready`, `outcome`, `conditions`, `method`) |
| Wait for checks    | `merge-ready.mjs check [pr] --wait` (polls every 30 s up to `checks_timeout_minutes`)            |
| Merge              | `merge-ready.mjs merge [pr] [--method <m>] [--dry-run]` (result block)                           |
| Halt               | `merge-ready.mjs merge [pr] --halt "<reason>"` (logs a Halt decision, never merges)              |
| Gates after rebase | `build.mjs gates --project-dir <repo>` (configured or detected gate commands)                    |

Each condition in the report is `pass`, `fail` or `pending`, with a reason. The outcomes:

| Outcome            | Meaning                                                                         | Action                              |
| ------------------ | ------------------------------------------------------------------------------- | ----------------------------------- |
| `ready`            | Every condition passes and a method is allowed                                  | Merge                               |
| `pending`          | Only checks are still running                                                   | Wait for checks, then check again   |
| `behind`           | The branch is behind the base                                                   | Rebase, then check again            |
| `conflict`         | The branch conflicts with the base                                              | Rebase and resolve, or halt         |
| `blocked`          | Draft, changes requested, unresolved threads, failing checks, or no method      | Merge reports it (`awaiting-human`) |
| `protected`        | Branch protection or rulesets block the merge (for example a required approval) | Merge reports it (`awaiting-human`) |
| `halted`           | The run is halted, or a Halt decision is not lifted                             | Merge reports it (`halted`)         |
| `queued`           | Already in the merge queue, or auto-merge already on                            | Merge reports it (`done`)           |
| `merged`, `closed` | Nothing left to merge                                                           | Merge reports it                    |

### Method Resolution

`merge-ready.mjs` resolves the method with `merge.method: repo`:

1. Read the allowed methods (`squashMergeAllowed`, `rebaseMergeAllowed`, `mergeCommitAllowed`), the branch rulesets (allowed merge methods, `required_linear_history`, `merge_queue`) and the classic branch protection (linear history), when readable.
2. A merge queue on the base branch: enqueue (`--auto`), and the queue decides.
3. One method allowed: use it.
4. Several: the first allowed in `merge.preference`, excluding `merge` under linear history.
5. An explicit method (`--method`, or `merge.method` other than `repo`) overrides, but errors if the repository does not allow it.
6. The method and the reason are logged as a decision (`phase: merge`) with `--run-dir`.

### Merge Lock

When the `AF_MERGE_LOCK` environment variable names a lock file (a harness that serializes merges per repository), `merge-ready.mjs merge` takes it before its final check and holds it until the cleanup: exclusive create, a lock older than 30 seconds is stale, and the holder refreshes it every 10 seconds. It emits `merge.locked` with `--run-dir`. A lock that stays busy for `merge.checks_timeout_minutes` ends `awaiting-human` without merging. Without `AF_MERGE_LOCK`, a standalone run merges directly. The skill never creates or removes the lock itself.

### Rebase and Re-Check

When the outcome is `behind` or `conflict`, and the pull request is not from a fork:

1. The working tree must be clean and on the pull request head branch (`gh pr checkout <pr>` otherwise; in a worktree, work there).
2. `git fetch origin <base>`, then `git rebase origin/<base>`.
3. On conflicts: resolve them only when both sides are clear (for example a changelog or a lockfile, or independent edits) and you can explain the result. Otherwise `git rebase --abort`, then `merge-ready.mjs merge --halt "rebase conflict with <base> in <files>"`, and go to the report.
4. Run the gates (`build.mjs gates`). If a gate fails because of the rebase and you cannot fix it in the rebased commits, halt the same way with the failing gate as the reason.
5. `git push --force-with-lease`, then wait for the checks of the new head (see Waiting for Checks) and check again.

Rebase at most 3 times per invocation: a base that keeps moving ends with the `behind` outcome of the last check. A fork pull request is never rebased: the merge reports `behind` or `conflict`.

### Waiting for Checks

Run `merge-ready.mjs check [pr] --wait` like `esp-await-review` runs its wait: in the background with an exit notification when the runtime has it (end the turn, do nothing until it exits), else in the foreground with the longest shell timeout. It exits when the outcome is no longer `pending`, or with `timed_out: true`. With `merge.use_auto_merge`, skip the wait: `merge` enables auto-merge on pending checks.

### Interactive Merge

In `all` mode, standalone and not headless: before the merge, show the conditions and the method with its reason, and ask whether to merge. On "no", leave the pull request open: run `merge-ready.mjs merge --dry-run` for the result block, and with `--run-dir` log the answer with `runs.mjs decision` (`source: operator`, `phase: merge`). In every other mode, merge without asking.

### Local Cleanup

After `outputs.merged` is `true`:

- `outputs.cleanup.worktree.remove` is `true`: leave the worktree (`cd` to `outputs.cleanup.worktree.main`), then `git worktree remove <path>`. Never pass `--force`: a dirty worktree is kept and reported.
- Otherwise, when the current branch is the merged head branch and `merge.delete_branch` is on: `git switch <base>`, `git pull --ff-only`, then `git branch -D <branch>` (the merge on GitHub is confirmed, so a squash or rebase merge does not lose work).

## Instructions

1. **Parse arguments**: read the flags and `[pr]`. Resolve the interactive mode (the flag, else `defaults.interactive`, `off` when headless).
2. **Load configuration** (see Configuration). With `merge.enabled: false`, skip to step 7: `merge` reports it.
3. **Check prerequisites**: `gh auth status` must succeed, and the pull request must exist. Otherwise report it and stop.
4. **Read operator messages**: with `--run-dir`, the injected `## Operator Messages` section and `runs.mjs messages`. A message that says not to merge ends the skill with `merge --halt "<message>"`. Deliver applied messages with `runs.mjs deliver`.
5. **Check**: `merge-ready.mjs check [pr] [--method]`. With `--dry-run`, skip to step 7.
6. **Act on the outcome** (see Scripts): `pending` -> wait for checks and check again; `behind` or `conflict` -> rebase and re-check (see Rebase and Re-Check). Repeat until the outcome is anything else, within the rebase limit.
7. **Confirm** (`all` mode only, see Interactive Merge).
8. **Merge**: `merge-ready.mjs merge [pr] [--method] [--dry-run]`. With `--run-dir`, pipe it into `runs.mjs result merge --run-dir <path>`, which records the step and prints the result line. The script re-checks under the merge lock, so a base that moved since step 6 ends `behind` without merging.
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
