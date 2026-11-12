# Workspace

Where the task works: the branch and the working directory. `ship.mjs workspace` picks one of three workspaces and records it in `ship.json` (`workspace`):

- **`checkout`**: a new branch in the main checkout
- **`existing-branch`**: a branch that already exists, checked out as is: `--branch <name>` (local, or tracked from `origin`), or the current branch when it is not the base or the default branch
- **`worktree`**: a task worktree under `worktrees.root`, with `--worktree` (or `ship.worktree`), or because the main checkout is dirty

## Dirty Tree

A dirty main checkout (`git status --porcelain` prints something) does not stop the run. With `ship.dirty_tree: worktree` (the default), the task runs in a task worktree and the dirty files stay untouched in the main checkout. `workspace` logs it as a `policy` decision that names the dirty files. With `ship.dirty_tree: fail`, `workspace` exits 1: report it and stop with `status: failed`.

A dirty tree with `--branch` naming the current branch always fails: the task work would mix with the uncommitted changes. The preflight checks it before the run starts.

## Branch Phase

`next` returns `phase: branch` with `cwd`. Record `phase branch --status started`, then run `ship.mjs workspace`, with `--branch <name>` when the operator gave `--branch`. Act on its `action`:

- **`use`**, **`checkout`**, **`create`**, **`worktree`**: the branch is ready, and `workspace` recorded `branch`, `base_sha` and, for a worktree, the working directory. `base_sha` is the merge-base with `origin/<base>` for an existing branch, and the start commit for a new one
- **`name-branch`**: the task needs a new branch. Build its name as `esp-branch` does (instruction 3 of `skills/git/esp-branch/SKILL.md`: `branch.pattern` with `--slug <slug from the plan title or the request>`, and the issue number when the request is a GitHub issue), then run `ship.mjs workspace --branch <name>` again. It creates the branch from `origin/<base>`, in the main checkout or in the task worktree

Then record `phase branch --status done`. Errors (exit 1) end the task with `ship.mjs stop --status failed --reason <error>`.

`workspace` is idempotent: once the branch is recorded, for example after a track switch or a resume, it returns `action: use` with the recorded workspace and `cwd`, and changes nothing.

Without the `branch` phase in `ship.phases`, the current branch must not be the default branch: stop with `status: failed` otherwise.

## Task Worktree

In a worktree workspace, `next` returns the worktree path as `cwd` from then on: every phase works there, and the main checkout stays untouched. `ship.mjs worktree --branch <name> [--from <ref>]` still creates a worktree directly, on a new branch from `origin/<base>` (or `--from`), when a caller needs one outside the branch phase. `esp-merge` removes the worktree after the merge per `worktrees.cleanup`.

## Summary

The result block carries `outputs.workspace` (`kind`, `branch`, `location`, `reason`, `dirty_files`, `worktree`, `cleanup`, `decision`). `summary.md` names the workspace in its outcome and, for a worktree, its path and its cleanup (`worktrees.cleanup`: `on-merge`, `on-finish` or `never`).
