# Pull Request Tail

The phases both tracks share once the work is committed: `pr`, `fix-review` and `merge`. Each fix round starts with a wait for the reviews and the CI checks of the head commit, run by this session as step `fix-review-wait` of the `fix-review` phase. `--no-pr` drops the tail, `--no-merge` drops the merge, and `--stop-before-wait` ends the skill once the pull request is open.

## Pull Request

`next` returns `phase: pr` with `draft` and `mark_ready`.

1. `phase pr --status started`.
2. Spawn the `mechanical` phase subagent: `git push -u origin <branch>`, then `skills/git/esp-pr/SKILL.md` with `--base <base>` (add `--draft` when `next.draft`). With `pr.body_from_run`, esp-pr builds the body from the run artifacts. On the inline track, this session may do the same steps itself instead of spawning: push, `ship.mjs pr-body --out <run-dir>/pr-body.md`, then `gh pr create --base <base> --title "<title>" --body-file <run-dir>/pr-body.md` (add `--draft` when `next.draft`).
3. `gh pr ready <url>` when `next.mark_ready`.
4. `phase pr --status done --pr <url>`. With `--stop-before-wait`, go to the result: the caller takes the tail from here.

## Review and Checks Wait

`next` returns `phase: fix-review` with `rounds` (the cumulative round number), `wait_step: fix-review-wait` and `wait_checks: true`. The wait runs in this session: the wait script wakes it on exit, so the wait costs no tokens and no subagent sleeps through it.

1. `phase fix-review --status started` (first round only).
2. Start the wait: `node "${CLAUDE_PLUGIN_ROOT}/scripts/wait-for-review.mjs" <pr url> --checks --reviewers <names> --run-dir <run-dir> --config-snapshot <config_snapshot from ship.json>` (the `--reviewers`, else leave the option out for `fix-review.wait.default_reviewers`). The script posts trigger comments itself when `fix-review.wait.auto_trigger` is on, keeps its clock in `<run-dir>/fix-review-wait.json`, and is done when every reviewer reviewed the head commit and no check is pending. Run it in the background with an exit notification when the runtime has it (with a shell timeout above `fix-review.wait.timeout_minutes`), and end the turn: the next action is reading the exit notification. Without background execution, run it in the foreground with the longest shell timeout. If the shell kills it first, run the same command again: the state file keeps the clock, so the total wait still honors the timeout.
3. Record the wait: pipe its output into `runs.mjs result fix-review-wait --run-dir <run-dir>`.
4. `ship.mjs pr-loop --after wait`:
   - **`fix`**: run a fix round. `failing_checks` names the checks that failed on the head. With `timed_out: true`, log a B-Decide decision: the comments and checks that arrived are fixed without waiting longer
   - **`stop`**: the task ends (the stop is recorded), for example on a closed pull request

## Fix Rounds

1. Spawn the `fixer` phase subagent on `skills/github/esp-fix-review/SKILL.md` with `--rounds <round> --pr <pr url>` (`round` from the `fix` action of `pr-loop --after wait`) (add `--reviewers <names>` when given), without `--wait`: this session already waited. One round per spawn, so the subagent never waits for a re-review itself. It fixes the comments and the failing checks of the head in the same round.
2. `ship.mjs pr-loop --after fix`:
   - **`wait`**: the round pushed commits and rounds are left. Wait again (Review and Checks Wait, step 2), then run the next fix round
   - **`merge`**: record `phase fix-review --status done`
   - **`stop`**: the task ends, for example with review items left open (`awaiting-human`, the pull request left open)
3. In `all` mode, show the round recap (fixed, rejected, deferred) and ask whether to continue or stop with the pull request open.

## Merge

1. With `pr.body_from_run`, refresh the body: `ship.mjs pr-body --out <run-dir>/pr-body.md`, then `gh pr edit <url> --body-file <run-dir>/pr-body.md`.
2. In `all` mode, ask whether to merge now or stop with the pull request open.
3. `phase merge --status started`, then spawn the `fixer` phase subagent on `skills/github/esp-merge/SKILL.md` with `--pr <pr url>`.
4. `phase merge --status done` when it ended `merged` or `done`. A merge blocked by a condition ends the task with `awaiting-human` and the pull request left open.
