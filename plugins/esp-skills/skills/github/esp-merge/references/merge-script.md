# Merge Script Behavior

What `scripts/merge-ready.mjs` decides on its own. The skill never repeats these decisions: read this file to explain a method choice or a lock wait to the user.

## Method Resolution

With `merge.method: repo`, the script resolves the method:

1. Read the allowed methods (`squashMergeAllowed`, `rebaseMergeAllowed`, `mergeCommitAllowed`), the branch rulesets (allowed merge methods, `required_linear_history`, `merge_queue`) and the classic branch protection (linear history), when readable.
2. A merge queue on the base branch: enqueue (`--auto`), and the queue decides.
3. One method allowed: use it.
4. Several: the first allowed in `merge.preference`, excluding `merge` under linear history.
5. An explicit method (`--method`, or `merge.method` other than `repo`) overrides, but errors if the repository does not allow it.
6. The method and the reason are logged as a decision (`phase: merge`) with `--run-dir`.

## Merge Lock

When the `AF_MERGE_LOCK` environment variable names a lock file (a harness that serializes merges per repository), `merge-ready.mjs merge` takes it before its final check and holds it until the cleanup: exclusive create, a lock older than 30 seconds is stale, and the holder refreshes it every 10 seconds. It emits `merge.locked` with `--run-dir`. A lock that stays busy for `merge.checks_timeout_minutes` ends `awaiting-human` without merging. Without `AF_MERGE_LOCK`, a standalone run merges directly.
