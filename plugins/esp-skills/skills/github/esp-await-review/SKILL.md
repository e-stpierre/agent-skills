---
name: esp-await-review
description: Wait in the background for bot reviews of a pull request's head commit, then report
argument-hint: "[--trigger] [--no-trigger] [--reviewers <names>] [--timeout <minutes>] [--run-dir <path>] [--config-snapshot <path>] [pr]"
disable-model-invocation: true
metadata: { af-contract: 1, af-level: reporting }
---

# ESP Await Review

## Overview

Wait until bot reviewers (Claude, Codex, or any GitHub login) have reviewed the current head commit of a pull request, without spending tokens on polling. The skill starts `scripts/wait-for-review.mjs` in the background and stops; the script polls GitHub through `gh` with backoff, matches each reviewer's review on the head SHA, optionally posts a reviewer's trigger comment, and exits when every reviewer is done, when the timeout expires, or when the pull request closes. The session resumes when the script exits and reports a contract result block. `esp-fix-review` is the usual next step.

## Arguments

### Definitions

- **`[--trigger]`** (optional): Post the trigger comment of each pending reviewer that has one (for example `@codex review`), once per head commit. Defaults to `await-review.auto_trigger` (`false`).
- **`[--no-trigger]`** (optional): Never post trigger comments, whatever the config says.
- **`[--reviewers <names>]`** (optional): Comma-separated reviewer names from `await-review.reviewers` (`claude`, `codex`), or raw GitHub logins (`my-bot[bot]`). Defaults to `go.default_reviewers`.
- **`[--timeout <minutes>]`** (optional): Give up after this many minutes. Defaults to `await-review.timeout_minutes` (30).
- **`[--run-dir <path>]`** (optional): Run directory owned by a harness or a parent skill. The progress file is `<run-dir>/await-review.json`, each completed review is recorded as a `review.received` event, and the result block is recorded as step `await-review`. Without it, no run is created.
- **`[--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run, passed to every script call.
- **`[pr]`** (optional): Pull request number, `#<number>`, or URL. Defaults to the pull request of the current branch.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the result block and exit codes, see [contract-notes.md](../../../references/contract-notes.md)
- For what a timeout means under the decision policy, see [decision-policy.md](../../../references/decision-policy.md)

## Core Principles

- Waiting never burns tokens: the script waits, the session does not. Never poll GitHub from the conversation, and never run `sleep` loops in the session
- A review counts only when it is on the current head commit. A review of an older commit is stale, and a push during the wait restarts the wait on the new head
- Post a trigger comment only when asked (`--trigger` or `auto_trigger`), at most once per reviewer and head commit
- Never change the repository or the pull request beyond trigger comments: no edits, commits, pushes, replies or review resolutions
- Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path. Never build or count the result block by hand

## Skill-Specific Guidelines

### Configuration

Read the section once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get await-review
```

If the command exits with code 1 (invalid config), report its error and stop. The script reads the same config itself, so the skill only needs it to report what it waits for.

| Key                            | Default                                                                                     | Effect                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `await-review.reviewers`       | `claude` (`claude[bot]`), `codex` (`chatgpt-codex-connector[bot]`, trigger `@codex review`) | Reviewer names, GitHub logins and trigger comments              |
| `await-review.timeout_minutes` | `30`                                                                                        | Time before the wait gives up                                   |
| `await-review.poll_seconds`    | `60`                                                                                        | First poll interval; it grows 1.5x per unchanged poll, up to 5x |
| `await-review.auto_trigger`    | `false`                                                                                     | Post trigger comments without `--trigger`                       |
| `go.default_reviewers`         | `["claude"]`                                                                                | Reviewers waited for when `--reviewers` is not given            |

### How Completion Is Detected

For each reviewer, on the current head commit, in this order:

1. A pull request review by the reviewer's login whose commit is the head SHA.
2. A comment by the login with a machine-readable review state for the head SHA marked completed. Codex posts no review when it has no findings, only a summary comment with this state.
3. A comment by the login, created or edited after the head commit date, that is not a progress placeholder ("is working", "in progress").

Logins match case-insensitively, with or without the `[bot]` suffix.

### Running the Wait

The command (add `--run-dir <path>` and `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/wait-for-review.mjs" [pr] --reviewers <names> --timeout-minutes <n> [--trigger|--no-trigger] --state <state-file>
```

- `<state-file>`: `<run-dir>/await-review.json` with `--run-dir` (the script's default, so `--state` can be omitted). Otherwise a file in a new temporary directory (`mktemp -d`).
- With `--run-dir`, pipe the output into `node "${CLAUDE_PLUGIN_ROOT}/scripts/runs.mjs" result await-review --run-dir <path>`, which records the step and prints the result line.
- Progress lines go to stderr; the last stdout line is the result block. Exit codes: 0 done, 10 awaiting-human, 1 failed, 2 usage error.

Pick the launch mode from the runtime, in this order:

1. **Background with exit notification** (for example the Bash tool's `run_in_background`, with a timeout above the wait timeout): start the command, tell the user what is being waited for, and end the turn. Do nothing else until the exit notification arrives.
2. **Foreground** (no background execution): run the same command in the foreground with the longest shell timeout available. If the shell kills it first, run the same command again with the same `--state` file: an interrupted wait keeps its clock, so the total wait still honors the timeout.

While it runs, `node "${CLAUDE_PLUGIN_ROOT}/scripts/wait-for-review.mjs" [pr] --once` (with the same reviewers) checks once without waiting, and the state file shows the last poll.

### Outcomes

| Status           | When                                                                             | Next step                                                        |
| ---------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `done`           | Every reviewer reviewed the head commit                                          | Fix the comments with `esp-fix-review`                           |
| `awaiting-human` | Timeout, with a `needs_input` request (wait or skip)                             | Interactive session: ask the question. Otherwise report and stop |
| `failed`         | The pull request is closed with reviews missing, or `gh` failed 5 times in a row | Report the summary                                               |

On a timeout in an interactive session (not headless, not a subagent), ask whether to wait again or continue without the missing reviews, with "wait again" first. On "wait again", run the wait again with a new `--state` file. With `--run-dir`, log the answer with `runs.mjs decision` (`source: operator`, `phase: await-review`).

## Instructions

1. **Parse arguments**: read the flags and `[pr]`.
2. **Check prerequisites**: `gh auth status` must succeed. Resolve the pull request with `gh pr view [pr] --json number,url,headRefOid`. If there is none, report it and stop.
3. **Load configuration** (see Configuration) and resolve the reviewer names, for the message to the user.
4. **Start the wait** (see Running the Wait). Tell the user which reviewers, which pull request and head commit, and the timeout. Then stop until the script exits.
5. **Read the result**: on exit, take the last stdout line (the result block, recorded by `runs.mjs result` with `--run-dir`). If the script exited with code 2, report the usage error and stop.
6. **Handle the outcome** (see Outcomes).
7. **Report**: one line per reviewer (reviewed, in progress or pending, with the review URL when there is one), then the result line as the final output line.

## Output Guidance

A short status, then the result block as the final line:

```markdown
Reviews of #42 at 3f2a1c0 are in:

- codex: reviewed (https://github.com/o/r/pull/42#pullrequestreview-123)
- claude: reviewed (comment)
```

```text
{"contract_version":1,"status":"done","summary":"codex, claude reviewed #42 at 3f2a1c0.","max_risk":"low","outputs":{"pr":42,"url":"https://github.com/o/r/pull/42","head":"3f2a1c0...","reviewers":{"codex":"reviewed","claude":"reviewed"},"completed":["codex","claude"],"pending":[],"triggered":["codex"],"polls":6,"waited_seconds":540,"state_path":"..."}}
```

On a timeout, the block has `status: awaiting-human`, the missing reviewers in `outputs.pending`, and a `needs_input` request with the options `wait` (recommended) and `skip`.
