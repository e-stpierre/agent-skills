# Pull Request Tail

The phases both tracks share once the work is committed: `pr`, `await-review`, `fix-review` and `merge`. `--no-pr` drops them all, `--no-merge` drops the merge, and `--stop-before-wait` ends the skill once the pull request is open.

## Pull Request

`next` returns `phase: pr` with `draft` and `mark_ready`.

1. `phase pr --status started`.
2. Spawn the `mechanical` phase subagent: `git push -u origin <branch>`, then `skills/git/esp-pr/SKILL.md` with `--base <base>` (add `--draft` when `next.draft`). With `pr.body_from_run`, esp-pr builds the body from the run artifacts. On the inline track, this session may do the same steps itself instead of spawning: push, `ship.mjs pr-body --out <run-dir>/pr-body.md`, then `gh pr create --base <base> --title "<title>" --body-file <run-dir>/pr-body.md` (add `--draft` when `next.draft`).
3. `gh pr ready <url>` when `next.mark_ready`.
4. `phase pr --status done --pr <url>`. With `--stop-before-wait`, go to the result: the caller takes the tail from here.

## Review Wait

The `await-review` phase runs in this session, not in a subagent: the wait script wakes this session when it exits, so the wait costs no tokens.

1. `phase await-review --status started` (first round only).
2. Start the wait: `node "${CLAUDE_PLUGIN_ROOT}/scripts/wait-for-review.mjs" <pr url> --reviewers <names> --run-dir <run-dir>` (the `--reviewers`, else `fix-review.wait.default_reviewers`; add `--trigger` when `fix-review.wait.auto_trigger` is on). It records the `await-review` step itself. Run it in the background with an exit notification when the runtime has it (with a shell timeout above `fix-review.wait.timeout_minutes`), and end the turn: the next action is reading the exit notification. Without background execution, run it in the foreground with the longest shell timeout. If the shell kills it first, run the same command again: the state file in the run directory keeps the clock, so the total wait still honors the timeout.
3. On exit, `ship.mjs pr-loop --after await`:
   - **`fix`**: record `phase await-review --status done` the first time, then run a fix round. With `timed_out: true`, log a B-Decide decision: the comments that arrived are fixed without waiting longer
   - **`stop`**: the task ends (the stop is recorded)

## Fix Rounds

`next` returns `phase: fix-review` with `rounds`, the cumulative round number.

1. Spawn the `fixer` phase subagent on `skills/github/esp-fix-review/SKILL.md` with `--rounds <next.rounds> --pr <pr url>` (add `--reviewers <names>` when given). One round per spawn, so the subagent never waits for a re-review itself.
2. `ship.mjs pr-loop --after fix`:
   - **`await`**: the round pushed commits and rounds are left. Wait again (Review Wait step 2), then the next fix round
   - **`merge`**: record `phase fix-review --status done`
   - **`stop`**: the task ends, for example with review items left open (`awaiting-human`, the pull request left open)
3. In `all` mode, show the round recap (fixed, rejected, deferred) and ask whether to continue or stop with the pull request open.

## Merge

1. With `pr.body_from_run`, refresh the body: `ship.mjs pr-body --out <run-dir>/pr-body.md`, then `gh pr edit <url> --body-file <run-dir>/pr-body.md`.
2. In `all` mode, ask whether to merge now or stop with the pull request open.
3. `phase merge --status started`, then spawn the `fixer` phase subagent on `skills/github/esp-merge/SKILL.md` with `--pr <pr url>`.
4. `phase merge --status done` when it ended `merged` or `done`. A merge blocked by a condition ends the task with `awaiting-human` and the pull request left open.
