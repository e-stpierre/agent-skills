---
name: esp-fix-review
description: Fix, reply to, or defer PR review comments and failing CI checks, or esp-review findings
argument-hint: "[--internal] [--rounds <n>] [--reviewers <names>] [--interactive <mode>] [--run-dir <path>] [--config-snapshot <path>] [target]"
disable-model-invocation: true
metadata: { af-contract: 1, af-level: steerable }
---

# ESP Fix Review

## Overview

Resolve review feedback under the decision policy, in a bounded number of rounds. In pull request mode, the skill fetches the review comments of a pull request (inline comments, review bodies, issue comments), keeps the ones from the requested reviewers that were not handled in an earlier round, classifies each as A-Fix, B-Decide, B-Scope or Reject, fixes what it should, fixes failing CI checks, commits the fixes as separate review-fix commits, pushes, replies to rejected and deferred comments, resolves the handled threads, and waits for the bots to re-review before the next round. In internal mode (`--internal`), it applies the findings of an `esp-review` run to the local branch, with no pull request. `scripts/fix-review.mjs` keeps the handled IDs, the rounds and the GitHub replies, and logs every resolution in `decisions.jsonl`. Deferred items come back as `discovered_items` in the result block.

## Arguments

### Definitions

- **`[--internal]`** (optional): Fix the findings of an `esp-review` run instead of pull request comments. `[target]` is then the findings file (`review-<N>.json`); with `--run-dir` it defaults to the latest one in the run. Nothing is pushed and nothing is posted on GitHub.
- **`[--rounds <n>]`** (optional): Maximum number of fix rounds, counted across invocations on the same run or state file. Defaults to `fix-review.max_rounds` (3). `--rounds 1` fixes once and returns without waiting for a re-review.
- **`[--reviewers <names>]`** (optional): Comma-separated reviewer names from `await-review.reviewers` (`claude`, `codex`) or raw GitHub logins. Only their comments are handled, and only they are waited for between rounds. Without it, comments from every author except yourself are handled, and the wait targets the `go.default_reviewers` that commented on the pull request.
- **`[--interactive <mode>]`** (optional): `off`, `plan` or `all`. Only `all` stops to settle B-Decide and B-Scope items with the user and shows a recap before pushing. `--interactive=<mode>` also works. Defaults to `defaults.interactive` (`off`). Headless sessions always use `off`.
- **`[--run-dir <path>]`** (optional): Run directory owned by a harness or a parent skill. The state is `<run-dir>/fix-review.json`, every resolution is logged in `decisions.jsonl`, and the result block is recorded as step `fix-review` (`fix-review-<N>` in internal mode, after `review-<N>`). Without it, the state goes to a temporary directory and no run is created.
- **`[--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run, passed to every script call.
- **`[target]`** (optional): Pull request number, `#<number>`, or URL. Defaults to the pull request of the current branch. With `--internal`: the path of an `esp-review` findings file.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the classes, risk levels, deferrals and stop conditions, see [decision-policy.md](../../../references/decision-policy.md)
- For the findings file that `--internal` consumes, see [esp-review](../../review/esp-review/SKILL.md)
- For the wait between rounds, see [esp-await-review](../esp-await-review/SKILL.md)
- For the result block and exit codes, see [contract-notes.md](../../../references/contract-notes.md)

## Core Principles

- Classify every item before acting on it, with the decision policy. When an item fits several classes, the most restrictive one wins
- Read every affected file before changing it. Validate each comment against the current code: a comment on an older revision, or one that the code already handles, is a Reject with the reason
- Never apply a B-Scope item autonomously. Defer it per `fix-review.deferred_items`, and return it as a discovered item
- Fix production bugs that tests reveal. Never silence, skip or weaken a test to make CI pass
- Run the gates locally before every commit. Do not push code that fails them
- Review fixes are their own commits, never an amend of a milestone commit. Never force-push, never rewrite pushed history
- Record every resolution with `fix-review.mjs record` when it is made. A handled item is never processed again, and the round limit is never exceeded
- Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path. Never post replies or resolve threads by hand, and never build the result block by hand
- In GitHub replies, never write `#<number>` for a finding: GitHub links it to an issue. Write `item 4` or `finding 4`

## Skill-Specific Guidelines

### Configuration

Read the sections once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get fix-review
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get commit
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), continue with the defaults.

| Key                            | Default     | Effect                                                                                    |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------------------- |
| `fix-review.max_rounds`        | `3`         | Round limit when `--rounds` is not given                                                  |
| `fix-review.fix_ci`            | `true`      | Diagnose and fix failing CI checks of the pull request head                               |
| `fix-review.reply_to_rejected` | `true`      | Reply with the reason to rejected comments                                                |
| `fix-review.deferred_items`    | `follow-up` | `follow-up`: reply, resolve, return a discovered item. `block`: leave open, end `awaiting-human` |
| `commit.review_fixes`          | `separate`  | `separate`: `fix(review): ...` commits. `fixup`: `fixup!` commits of the milestone commit |
| `go.default_reviewers`         | `["claude"]` | Reviewers waited for between rounds when `--reviewers` is not given                      |
| `go.halt_on`                   | all keys    | With `budget`, rounds exhausted with items left halts the task                            |
| `defaults.interactive`         | `off`       | Interactive mode when `--interactive` is not given                                        |

### Scripts

`scripts/fix-review.mjs` keeps the state. Every call takes `--run-dir <path>`, or `--state <file>` without a run (a file in a new `mktemp -d` directory, the same for the whole invocation), plus `--config-snapshot <path>` when given:

| Moment              | Command                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Start a round       | `fix-review.mjs round [--max-rounds <n>]` (`{ round, exhausted, last }`)                     |
| Pull request items  | `fix-review.mjs fetch [pr] [--reviewers <names>]`                                            |
| Internal items      | `fix-review.mjs internal [findings]`                                                         |
| CI checks           | `fix-review.mjs checks [pr]` (`{ failing, pending, passing }`)                               |
| Record a resolution | `fix-review.mjs record --json '<resolution>'`                                                |
| Replies and threads | `fix-review.mjs respond`                                                                     |
| Result block        | `fix-review.mjs result [--remaining <n>]`                                                    |
| Operator messages   | `runs.mjs messages --run-dir <path>`, then `runs.mjs deliver <id>...` once applied          |

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

### Classifying Items

Follow the decision policy. For pull request comments:

| Class    | Typical comment                                                                         | Action                                         |
| -------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A-Fix    | A real bug, a missing check, a convention the repo documents, one clear fix             | Fix                                            |
| B-Decide | A real issue with several fixes, none changing scope                                    | Apply the best fit, record `alternatives`      |
| B-Scope  | A new feature, a public API or schema change, a behavior change users would notice      | Defer per `fix-review.deferred_items`          |
| Reject   | Wrong, outdated (`outdated: true` and no longer true), already handled, a preference the repo does not enforce | Reply with the reason        |

In internal mode, the finding's class is the reviewer's verified proposal: A becomes A-Fix, a B-Decide applies its `decision` line when it has one, else its `recommended` option. Re-check each finding against the code first: reject one you can prove wrong, with the reason.

A critical security or data-loss item that you cannot fix with high confidence is a Halt (`critical-security`) when that key is in `go.halt_on`: record it as `open`, fix nothing it touches, and end the round.

### Committing Fixes

- **`separate`** (default): group the fixes of a round by size. Small, local fixes go together in one commit, `fix(review): <summary>`, whose body lists each fix with its item URL or finding ID. A large or structurally separate fix gets its own commit. CI fixes are `fix(ci): <summary>` commits; a fix that answers both a comment and a failing check is one commit that names both.
- **`fixup`**: commit each fix with `git commit --fixup=<sha>`, where `<sha>` is the commit on the branch that last changed the main file of the fix (`git log -1 --format=%H <base>..HEAD -- <file>`), or a `fix(review)` commit when there is none. History is not rewritten: squashing the `fixup!` commits is left to the merge method or the user.
- Commit with git directly. Read `commit.co_author` for the attribution trailer, as `esp-commit` does.
- Before each commit, run the repo gates that cover the change (`build.gates`, else the project's test, lint and typecheck scripts). If they fail and you cannot fix them, revert that fix, record the item as `open` with the failure, and continue with the others.

### CI Checks

When `fix-review.fix_ci` is on, in pull request mode, after the comments of a round:

1. Run `fix-review.mjs checks`. With checks pending, wait for them in the background like `esp-await-review` does (`gh pr checks <n> --watch`, with a timeout of `merge.checks_timeout_minutes`, 30 by default), then run `checks` again.
2. For each failing check not yet `handled`: read its log (`gh run view <run-id> --log-failed`, the run ID from the check `link`), find the root cause, reproduce it locally with the matching project command, and fix it.
3. Lint and format failures: run the project's auto-fix command when it has one. Test failures: fix the production code when the test reveals a real bug, the test only when the code change was intended.
4. Record each check with its `check:` ID: `fixed` with the commit, or `open` with the diagnosis when you cannot fix it.

### The Round Loop

A round is: fetch, classify, fix, commit, push, respond. Between rounds, the bots re-review the new head:

- Wait only when the round pushed a commit, the limit is not reached (`last` is false), and there are reviewers to wait for: the `--reviewers`, else the `go.default_reviewers` in `reviewers_seen`.
- Wait with `wait-for-review.mjs <pr> --reviewers <names> --run-dir <path>` (or `--state <file>`), launched in the background as `esp-await-review` describes. Do not record its output as a step. Pass `--trigger` when `await-review.auto_trigger` is on.
- Stop the loop when the wait ends `awaiting-human` or `failed`, when a fetch returns no items and no failing check, or when `round` returns `exhausted: true`. Count the items still unhandled at that point: they are `--remaining <n>` for `result`.

### Interactive Fix-Review

In `all` mode, standalone and not headless:

1. After classifying a round, show the items grouped as A-Fix, B-Decide, B-Scope and Reject.
2. For each B-Decide item, ask which option to apply, with the recommended one first. For each B-Scope item, ask whether to defer it, fix it now, or reject it.
3. Before pushing, show the recap: commits, replies to post, items deferred. Push only after the user agrees.

Record each answer with `source: operator`. In every other mode, apply the autonomous column of the decision policy.

## Instructions

1. **Parse arguments**: read the flags and `[target]`. Resolve the interactive mode (the flag, else `defaults.interactive`, `off` when headless).
2. **Load configuration** (see Configuration).
3. **Check prerequisites**: in pull request mode, `gh auth status` must succeed and the pull request must exist and be open. The working tree must be clean and on the pull request branch (internal mode: on the branch that was reviewed). Otherwise report it and stop.
4. **Prepare the state**: with `--run-dir`, use it. Otherwise create a temporary directory and pass `--state <dir>/fix-review.json` to every call.
5. **Read operator messages**: the injected `## Operator Messages` section, plus `runs.mjs messages` with `--run-dir`. They override comments they contradict. Deliver them with `runs.mjs deliver` once applied.
6. **Start a round**: run `fix-review.mjs round` with `--max-rounds` from `--rounds`. If it returns `exhausted: true`, go to step 12.
7. **Fetch items**: `fix-review.mjs fetch [pr] [--reviewers]`, or `fix-review.mjs internal [findings]` with `--internal`. If `pending_github` is not empty, run `fix-review.mjs respond` first: a previous run stopped before replying.
8. **Classify and resolve** (see Classifying Items): read the code each item points at, decide its class, apply the fixes, and record each resolution. Record noise as `skipped` in one call.
9. **Fix CI** (pull request mode, `fix_ci` on, see CI Checks).
10. **Commit, push and respond** (see Committing Fixes): commit, then record the fixed items with their commit. In pull request mode, `git push` (never forced), then `fix-review.mjs respond`. In `all` mode, show the recap before pushing. Internal mode never pushes.
11. **Next round** (see The Round Loop): wait for the re-review and go back to step 6, or stop.
12. **Write the result block**: `fix-review.mjs result --remaining <n>`. With `--run-dir`, pipe it into `runs.mjs result <step>` (`fix-review`, or `fix-review-<N>` in internal mode for findings `review-<N>.json`), which records it and prints the final line.
13. **Report** (see Output Guidance), then the result line as the final output line.

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

`status` is `awaiting-human` when an item is `open` (with a blocking `needs_input` under `--run-dir`), and `halted` when the rounds ran out with items left and `budget` is in `go.halt_on`.
