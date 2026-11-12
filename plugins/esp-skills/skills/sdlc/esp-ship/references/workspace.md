# Workspace

Where the task works: the branch and the working directory. The preflight in SKILL.md requires a clean working tree, so the work never mixes with uncommitted changes.

## Branch Phase

`next` returns `phase: branch` with `cwd`. Record `phase branch --status started`, then:

- **Already on a branch** (`ship.json` has `branch` set, for example after a track switch): check it out and record `phase branch --status done --branch <name> --base-sha <sha>`
- **Inline track on a branch other than the base or the default branch**: use the current branch as is. Record `phase branch --status done --branch <name> --base-sha <git merge-base HEAD origin/<base>>`
- **Otherwise**: spawn the `mechanical` phase subagent: `git fetch origin <base>`, then `skills/git/esp-branch/SKILL.md` with `--slug <slug from the plan title or the request> --base origin/<base>` (add `--issue <number>` when the request is a GitHub issue). The subagent records `runs.mjs result branch` with `outputs.branch` and `outputs.base_sha`. Then record `phase branch --status done --branch <name> --base-sha <sha>`. On the inline track, this session may run the same steps itself: invoke `esp-branch` when the runtime has a skill tool, otherwise follow its `SKILL.md`

Without the `branch` phase in `ship.phases`, the current branch must not be the default branch: stop with `status: failed` otherwise.

## Task Worktree

With `--worktree` (or `ship.worktree`), `ship.json` has `use_worktree: true`. Pick the branch name per `branch.pattern` (as esp-branch does), then run `ship.mjs worktree --branch <name>` instead of a checkout: it creates the worktree under `worktrees.root` on a new branch from `origin/<base>` (or `--from <ref>`), and records it as the working directory. From then on, `next` returns that path as `cwd`: every phase works there, and the main checkout stays untouched. `esp-merge` removes the worktree after the merge per `worktrees.cleanup`.
