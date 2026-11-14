---
name: esp-fix-review
description: Resolve PR review comments, failing CI checks, or esp-review findings
argument-hint: "[-l|--internal] [-w|--wait] [-t|--timeout <minutes>] [-m|--rounds <n>] [-r|--reviewers <name>...] [-i|--interactive <mode>] [-p|--pr <pr>] [-e|--findings <path>] [-d|--run-dir <path>] [-c|--config-snapshot <path>]"
disable-model-invocation: true
metadata: { af-contract: 1, af-level: steerable }
---

# ESP Fix Review

## Overview

Resolve review feedback under the decision policy, in a bounded number of rounds. In pull request mode, a round handles the new review comments and the failing CI checks of the pull request: fix, commit, push, reply, resolve threads, then wait for the re-review. `--wait` adds that wait before round 1, so one invocation covers the whole review loop. In internal mode (`--internal`), the skill applies the findings of an `esp-review` run to the local branch, with no pull request. Deferred items come back as `discovered_items` in the result block.

## Arguments

### Definitions

Read each option by its short or its long name (`-m 2`, `--rounds 2` or `--rounds=2`).

- **`[-l|--internal]`** (optional): Fix the findings of an `esp-review` run instead of pull request comments. Nothing is pushed and nothing is posted on GitHub.
- **`[-w|--wait]`** (optional): Before round 1, wait until every reviewer has reviewed the head commit and no CI check of that commit is pending (see Waiting for Reviews and Checks). Without it, round 1 starts at once with the comments and checks already there. Ignored with `--internal`.
- **`[-t|--timeout <minutes>]`** (optional): Time limit of each wait. Defaults to `fix-review.wait.timeout_minutes` (30).
- **`[-m|--rounds <n>]`** (optional): Maximum number of fix rounds, counted across invocations on the same run or state file. Defaults to `fix-review.max_rounds` (3). `--rounds 1` fixes once and returns without waiting for a re-review.
- **`[-r|--reviewers <name>...]`** (optional): Reviewer names from `fix-review.wait.reviewers` (`claude`, `codex`) or raw GitHub logins. Repeat the option (`-r claude -r codex`) or give a comma-separated list (`-r claude,codex`). Only their comments are handled, and only they are waited for. Without it, comments from every author except yourself are handled. The `--wait` wait targets `fix-review.wait.default_reviewers`, and the wait between rounds targets the default reviewers that commented on the pull request.
- **`[-i|--interactive <mode>]`** (optional): `off`, `plan` or `all`. Only `all` stops to settle B-Decide and B-Scope items with the user and shows a recap before pushing. Defaults to `defaults.interactive` (`off`). Headless sessions always use `off`.
- **`[-p|--pr <pr>]`** (optional): Pull request number, `#<number>`, or URL. Defaults to the pull request of the current branch. Ignored with `--internal`.
- **`[-e|--findings <path>]`** (optional): With `--internal`, the `esp-review` findings file (`review-<N>.json`). Defaults to the latest one in `--run-dir`; required with `--internal` when there is no `--run-dir`.
- **`[-d|--run-dir <path>]`** (optional): Run directory owned by a harness or a parent skill. The state is `<run-dir>/fix-review.json`, every resolution is logged in `decisions.jsonl`, the wait keeps its progress in `<run-dir>/fix-review-wait.json` and records each review as a `review.received` event, and the result block is recorded as step `fix-review` (`fix-review-<N>` in internal mode, after `review-<N>`). Without it, the state goes to a temporary directory and no run is created.
- **`[-c|--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run, passed to every script call.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the classes, risk levels, deferrals and stop conditions, see [decision-policy.md](../../../references/decision-policy.md)
- For the findings file that `--internal` consumes, see [esp-review](../../review/esp-review/SKILL.md)
- For the scoped and full gates inside an esp-ship run, see [gates.md](../../sdlc/esp-ship/references/gates.md)
- For the result block and exit codes, see [contract-notes.md](../../../references/contract-notes.md)

## Core Principles

- Classify every item with the decision policy before acting on it
- Validate each comment against the current code: a comment on an older revision, or one that the code already handles, is a Reject with the reason
- Fix production bugs that tests reveal. A test changes only when the code change it covers was intended; silencing, skipping or weakening a test to make CI pass is never a fix
- The script waits, the session sleeps: start the wait, end the turn, and resume on the exit notification. Polling GitHub from the conversation or running `sleep` loops is never the wait
- A review or a check counts only on the current head commit. A push during a wait restarts it on the new head
- Run the scoped checks of the files a fix touches while fixing, and the full gates once before each commit (internal mode) or push (pull request mode). Push only code that passes them
- Review fixes are new commits on top of the branch, pushed with a plain `git push`: no amend of a milestone commit, no force-push, no rewrite of pushed history
- Record every resolution with `fix-review.mjs record` when it is made. A handled item is never processed again, and the round limit is never exceeded
- Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path. Replies, thread resolutions and the result block always go through `fix-review.mjs`
- In GitHub replies, name a finding `item 4` or `finding 4`: GitHub links `#<number>` to an issue

## Skill-Specific Guidelines

### Configuration

Read the sections once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get fix-review
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get commit
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), continue with the defaults.

- **`fix-review.max_rounds`** (`3`): round limit when `--rounds` is not given
- **`fix-review.fix_ci`** (`true`): diagnose and fix the failing CI checks of the pull request head
- **`fix-review.reply_to_rejected`** (`true`): reply with the reason to rejected comments
- **`fix-review.deferred_items`** (`follow-up`): `follow-up` replies, resolves and returns a discovered item. `block` leaves the item open and ends `awaiting-human`
- **`fix-review.wait.reviewers`** (`claude` as `claude[bot]`, `codex` as `chatgpt-codex-connector[bot]` with trigger `@codex review`): reviewer names, GitHub logins and trigger comments
- **`fix-review.wait.default_reviewers`** (`["claude"]`): reviewers waited for when `--reviewers` is not given
- **`fix-review.wait.timeout_minutes`** (`30`): time limit of each wait when `--timeout` is not given
- **`fix-review.wait.poll_seconds`** (`60`): first poll interval. It grows 1.5x per unchanged poll, up to 5x
- **`fix-review.wait.auto_trigger`** (`false`): post the trigger comment of a pending reviewer that has one, once per head commit. There is no flag for it
- **`fix-review.wait.checks_grace_seconds`** (`120`): an empty check list counts as pending for this long after the head commit (checks register a short time after a push), then as "no checks"
- **`commit.review_fixes`** (`separate`): `separate` makes `fix(review): ...` commits. `fixup` makes `fixup!` commits of the milestone commit
- **`ship.halt_on`** (every key): with `budget`, rounds exhausted with items left halt the task. With `critical-security`, an unfixable critical item halts
- **`defaults.interactive`** (`off`): interactive mode when `--interactive` is not given

### Scripts

`scripts/fix-review.mjs` keeps the state. Every call takes the same state options for the whole invocation, plus `--config-snapshot <path>` when given:

- Pull request mode with `--run-dir`: `--run-dir <path>` (state in `<run-dir>/fix-review.json`).
- Internal mode with `--run-dir`: `--run-dir <path> --state <run-dir>/fix-review-<N>.json`, N from the findings file `review-<N>.json`, so each internal round keeps its own round counter, apart from the pull request rounds.
- Without `--run-dir`: `--state <dir>/fix-review.json`, in a new `mktemp -d` directory.

- **Start a round**: `fix-review.mjs round [--max-rounds <n>]` (`{ round, exhausted, last }`)
- **Pull request items**: `fix-review.mjs fetch [<pr>] [--reviewers <a,b>]`
- **Internal items**: `fix-review.mjs internal [<findings>]`
- **CI checks**: `fix-review.mjs checks [<pr>]` (`{ failing, pending, passing }`)
- **Record a resolution**: `fix-review.mjs record --json '<resolution>'`
- **Replies and threads**: `fix-review.mjs respond`
- **Result block**: `fix-review.mjs result [--remaining <n>]`
- **Operator messages**: `runs.mjs messages --run-dir <path>`, then `runs.mjs deliver <id>...` once applied

`fetch` returns `{ pr, url, head, branch, items, skipped, reviewers_seen, pending_github }`. Each item has an `id` (`inline:<id>`, `review:<id>`, `comment:<id>`), its `author`, `bot`, `body`, `path` and `line` for inline comments, `outdated`, and `url`. Your own comments, resolved threads and handled items are left out. `internal` returns items with `id` `finding:review-<N>:F<n>` and the finding's `class`, `severity`, `location`, `fix`, `options` and `recommended`. Failing checks have the `id` `check:<name>@<sha>`.

A resolution:

```json
{
  "items": ["inline:101"],
  "resolution": "fixed",
  "class": "A-Fix",
  "decision": "Fixed the loop bound in sum()",
  "rationale": "the loop skipped the last element",
  "files": ["src/math.js"],
  "commit": "3f2a1c0",
  "reply": null,
  "discovered_item": null
}
```

- `resolution`: `fixed` (A-Fix, B-Decide), `rejected` (Reject), `deferred` (B-Scope, or a valid item outside the task), `skipped` (noise: praise, acknowledgments, bot progress placeholders and summaries without findings; class Reject), or `open` (needs an answer the skill cannot get: B-Decide, B-Scope or Halt).
- `reply`: the text posted on GitHub. Give it for `rejected` (the reason; not posted when `reply_to_rejected` is off), `deferred` (why, and where it is tracked) and `open` (the question). Leave it null for `fixed` and `skipped`.
- `discovered_item`: for `deferred`, `{ type, title, evidence, severity?, files? }` with `type` one of `bug`, `debt`, `security`, `docs`, `test`, `follow-up`, `other`.
- `alternatives`: for B-Decide, the options not taken. `risk` defaults to `medium` for B-Decide, else from the resolution (`low`, `medium` for deferred, `high` for open). Raise it for anything touching security, data or a public API.
- One call can record several items with the same resolution, for example every skipped comment, or the fixes in one commit.

With `--run-dir`, `record` logs the decision (`phase: fix-review`, `x-esp-class`, the comment URLs in `refs`). `respond` then posts the owed replies, resolves fixed and deferred threads (and bot threads it rejected), and minimizes fixed bot comments. An item whose GitHub action failed stays pending, and the next `respond` retries it.

### Waiting for Reviews and Checks

The wait command (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/wait-for-review.mjs" <pr> --reviewers <a,b> --checks [--timeout-minutes <n>] --state <state-file> [--run-dir <path>]
```

- `--reviewers`: the reviewer names joined with commas. Leave it out to wait for `fix-review.wait.default_reviewers`. For a checks-only wait, pass `--reviewers ""`: `--checks` still waits for the checks. `--timeout-minutes`: the `--timeout` value, left out without it.
- `<state-file>`: `<run-dir>/fix-review-wait.json` with `--run-dir` (the script's default), else a file in the temporary state directory. The script posts the trigger comments itself when `fix-review.wait.auto_trigger` is on.
- The wait is done when every reviewer reviewed the head commit **and** no check is pending. A failing check never ends it early: the reviews are always awaited, so one round fixes both. The result block carries `outputs.checks` (`{ failing, pending, passing }`). The wait belongs to this step: keep its result, with no `runs.mjs result` call.
- Progress goes to stderr, the last stdout line is the result block. Exit codes: 0 done, 10 awaiting-human (timeout), 1 failed (closed pull request, `gh` failed 5 times in a row), 2 usage error.

How a review counts, for each reviewer on the head commit, strongest first: a pull request review by its login on the head SHA; a comment by the login with a machine-readable review state for the head SHA marked completed (Codex posts only that summary when it has no findings); a comment by the login, created or edited after the head commit date, that is not a progress placeholder. Logins match case-insensitively, with or without the `[bot]` suffix.

Pick the launch mode from the runtime, in this order:

1. **Background with exit notification** (for example the Bash tool's `run_in_background`, with a timeout above the wait timeout): start the command, tell the user what is being waited for, and end the turn. The next action is reading the exit notification.
2. **Foreground** (no background execution): run the same command in the foreground with the longest shell timeout available. If the shell kills it first, run the same command again with the same `--state` file: an interrupted wait keeps its clock, so the total wait still honors the timeout.

While it runs, the same command with `--once` checks once without waiting, and the state file shows the last poll.

Outcomes:

- **`done`**: run the round with the comments that arrived and the failing checks in `outputs.checks.failing`
- **`awaiting-human`** (timeout): in an interactive session (not headless, not a subagent), ask whether to wait again or continue with what arrived, "wait again" first. On "wait again", run the same command with the same `--state` file. Headless or in a subagent, continue with the comments and checks that arrived. With `--run-dir`, log the choice with `runs.mjs decision` (`phase: fix-review`, `source: operator` for an answer, `policy` for the headless continue)
- **`failed`**: report the summary and go to the result block with the items left as `--remaining`

### Classifying Items

The decision policy defines the classes and what each one does. For pull request comments, an `outdated: true` comment is a Reject only when it no longer holds on the current code, and a B-Decide records its `alternatives`.

In internal mode, the finding's class is the reviewer's verified proposal: A becomes A-Fix, a B-Decide applies its `decision` line when it has one, else its `recommended` option. Re-check each finding against the code first: reject one you can prove wrong, with the reason.

A critical security or data-loss item that you cannot fix with high confidence is a Halt (`critical-security`) when that key is in `ship.halt_on`: record it as `open`, fix nothing it touches, and end the round.

### Committing Fixes

- **`separate`** (default): group the fixes of a round by size. Small, local fixes go together in one commit, `fix(review): <summary>`, whose body lists each fix with its item URL or finding ID. A large or structurally separate fix gets its own commit. CI fixes are `fix(ci): <summary>` commits; a fix that answers both a comment and a failing check is one commit that names both.
- **`fixup`**: commit each fix with `git commit --fixup=<sha>`, where `<sha>` is the commit on the branch that last changed the main file of the fix (`git log -1 --format=%H <base>..HEAD -- <file>`), or a `fix(review)` commit when there is none. History is not rewritten: squashing the `fixup!` commits is left to the merge method or the user.
- Commit with git directly. Read `commit.co_author` for the attribution trailer, as `esp-commit` does.
- While fixing, run the scoped checks of the files you touched: inside an esp-ship run (`--run-dir` with a `ship.json`), `node "${CLAUDE_PLUGIN_ROOT}/scripts/ship.mjs" milestone gates --run-dir <path> --files <a,b>` returns them as `commands`; elsewhere, the project's test command for those files. Then run the full gates once (`ship.gates`, else the project's test, lint and typecheck scripts) before the commit in internal mode, or before the push in pull request mode. If they fail and you cannot fix them, revert that fix, record the item as `open` with the failure, and continue with the others.

### CI Checks

When `fix-review.fix_ci` is on, in pull request mode, after the comments of a round:

1. Take the failing checks: `outputs.checks.failing` of the wait that started the round, else `fix-review.mjs checks`. Never start a `gh pr checks --watch`: a check still pending is handled in the next round, after the next wait.
2. For each failing check not yet `handled` (`fix-review.mjs checks` gives the `check:` IDs and the `handled` state): read its log (`gh run view <run-id> --log-failed`, the run ID from the check `link`), find the root cause, reproduce it locally with the matching project command, and fix it.
3. Lint and format failures: run the project's auto-fix command when it has one. Test failures: fix them as Core Principles says for tests.
4. Record each check with its `check:` ID: `fixed` with the commit, or `open` with the diagnosis when you cannot fix it.

### The Round Loop

A round is: fetch, classify, fix, commit, push, respond. Between rounds, the bots re-review the new head and the checks run again:

- Wait only when the round pushed a commit and the limit is not reached (`last` is false). The reviewers are the `--reviewers`, else the `fix-review.wait.default_reviewers` in `reviewers_seen`; with none, the wait covers the checks only (`--reviewers ""`).
- Wait with the command of Waiting for Reviews and Checks, `--checks` included.
- Stop the loop when the wait ends `failed`, or `awaiting-human` with no choice to continue, when a fetch returns no items and no failing check, or when `round` returns `exhausted: true`. Count the items still unhandled at that point: they are `--remaining <n>` for `result`.

### Interactive Fix-Review

In `all` mode, standalone and not headless:

1. After classifying a round, show the items grouped as A-Fix, B-Decide, B-Scope and Reject.
2. For each B-Decide item, ask which option to apply, with the recommended one first. For each B-Scope item, ask whether to defer it, fix it now, or reject it.
3. Before pushing, show the recap: commits, replies to post, items deferred. Push only after the user agrees.

Record each answer with `source: operator`. In every other mode, apply the autonomous column of the decision policy.

## Instructions

1. **Parse arguments**: read every option by its short or long name, and collect the reviewer names of every `-r|--reviewers` value. Resolve the interactive mode (`-i|--interactive`, else `defaults.interactive`, `off` when headless).
2. **Load configuration** (see Configuration).
3. **Check prerequisites**: in pull request mode, `gh auth status` must succeed and the pull request must exist and be open. The working tree must be clean and on the pull request branch (internal mode: on the branch that was reviewed). Otherwise report it and stop.
4. **Prepare the state**: pick the state options of the mode (see Scripts), creating the temporary directory when there is no `--run-dir`. Every later `fix-review.mjs` call carries them.
5. **Wait** (`--wait`, pull request mode): run the wait (see Waiting for Reviews and Checks) and handle its outcome. Done when the script has exited and the outcome says to continue.
6. **Read operator messages**: the injected `## Operator Messages` section, plus `runs.mjs messages` with `--run-dir`. They override comments they contradict. Deliver them with `runs.mjs deliver` once applied.
7. **Start a round**: run `fix-review.mjs round`, with `--max-rounds <n>` when `-m|--rounds` is given. If it returns `exhausted: true`, go to step 13.
8. **Fetch items**: `fix-review.mjs fetch [<pr>] [--reviewers <a,b>]` (the `--pr` value, the reviewer names joined with commas), or `fix-review.mjs internal [<findings>]` (the `--findings` value) with `--internal`. If `pending_github` is not empty, run `fix-review.mjs respond` first: a previous run stopped before replying.
9. **Classify and resolve** (see Classifying Items): read the code each item points at, decide its class, apply the fixes, and record each resolution. Record noise as `skipped` in one call. The step is done when every fetched item has a recorded resolution.
10. **Fix CI** (pull request mode, `fix_ci` on, see CI Checks): done when every failing check is recorded `fixed` or `open`.
11. **Commit, push and respond** (see Committing Fixes): commit, then record the fixed items with their commit. In pull request mode, `git push`, then `fix-review.mjs respond`. In `all` mode, show the recap before pushing. Internal mode never pushes.
12. **Next round** (see The Round Loop): wait for the re-review and the checks, then go back to step 7, or stop.
13. **Write the result block**: `fix-review.mjs result --remaining <n>`. With `--run-dir`, pipe it into `runs.mjs result <step>` (`fix-review`, or `fix-review-<N>` in internal mode for findings `review-<N>.json`), which records it and prints the final line.
14. **Report** (see Output Guidance), then the result line as the final output line.

## Output Guidance

A short report per category, then the result block as the final line:

```markdown
### Fix-review: PR 42, 2 rounds

- **Fixed** (2 commits): off-by-one in `sum()` (codex, inline), missing divide test (claude), lint failure in CI
- **Rejected**: null check in `src/cli.js` (input is validated in `parse()`), replied
- **Deferred**: rename `getUser()` to `fetchUser()` (public API), follow-up item, replied and resolved
- **Open**: none
- **Pushed**: yes, head 9b8e7d6
```

```text
{"contract_version":1,"status":"done","summary":"Fix-review of PR 42 over 2 rounds: 2 fixed, 1 rejected, 1 deferred, 1 CI fixes.","max_risk":"medium","commit":"9b8e7d6","pr":"https://github.com/o/r/pull/42","outputs":{"mode":"pr","pr":42,"rounds":2,"max_rounds":3,"exhausted":false,"remaining":0,"fixed":2,"rejected":1,"deferred":1,"skipped":3,"open":0,"ci_fixed":1,"commits":["4c1d2e3","9b8e7d6"],"pending_github":0,"state_path":"..."},"discovered_items":[{"type":"follow-up","title":"Rename getUser() to fetchUser()","evidence":"https://github.com/o/r/pull/42#discussion_r1"}]}
```

`status` is `awaiting-human` when an item is `open` (with a blocking `needs_input` under `--run-dir`), and `halted` when the rounds ran out with items left and `budget` is in `ship.halt_on`.
