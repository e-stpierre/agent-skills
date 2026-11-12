---
name: esp-review
description: Code review in a fresh context, returning verified findings classified for a fixer. Use when asked to review local changes, a branch, a ref range or a pull request.
argument-hint: "[-a|--focus <area>] [-p|--plan <path>] [-t|--target <target>] [-i|--interactive <mode>] [-d|--run-dir <path>] [-c|--config-snapshot <path>]"
metadata: { af-contract: 1, af-level: reporting }
---

# ESP Review

## Overview

Review a set of code changes in a fresh context and report verified, classified findings. The skill resolves the diff (local changes, a branch, a ref range, or a GitHub pull request), hands it to the read-only `esp-reviewer`, which checks it against the configured dimensions (correctness, security, plan conformance, tests, conventions, simplification, performance) in a find pass and a verify pass, and classifies every surviving finding as A, B-Decide or B-Scope with a severity and a fix. A fixer (`esp-fix-review --internal`, `esp-ship`) can then act without asking. The skill produces text and a contract result block; the caller decides where the review goes (terminal, PR comment, file, CI log).

## Arguments

### Definitions

Read each option by its short or its long name (`-t main`, `--target main` or `--target=main`). Quote a value with spaces (`-t "PR 42"`).

- **`[-a|--focus <area>]`** (optional): What to weigh most. A comma-separated list of dimension names (`security,tests`) reviews only those dimensions. Any other text (`token refresh`) is a concern the reviewer weighs more heavily, on the configured dimensions.
- **`[-p|--plan <path>]`** (optional): Plan the diff implements, for the `plan-conformance` dimension. With `--run-dir`, defaults to the latest plan of the run (`runs.mjs plan`). Without a plan, `plan-conformance` is skipped.
- **`[-t|--target <target>]`** (optional): What to review. Defaults to the local changes (staged, unstaged and untracked, against HEAD), or, when the tree is clean, the current branch against its merge base with the default branch. Values:
  - `staged` or `unstaged`: only those changes
  - `<ref>` (`main`, `origin/main`): commits on HEAD that are not on `<ref>`, from the merge base
  - `<base>..<head>` or `<base>...<head>`: an explicit range
  - `PR <number>`, `#<number>`, or a pull request URL: a GitHub pull request, through `gh`
- **`[-i|--interactive <mode>]`** (optional): `off`, `plan` or `all`. Only `all` stops after the review to settle B-Decide and B-Scope findings with the user. Defaults to `defaults.interactive` (`off`). Headless sessions always use `off`.
- **`[-d|--run-dir <path>]`** (optional): Run directory owned by a harness or a parent skill. The diff, the review and the findings are saved there, and the result block is recorded as step `review-<N>`. Without it, the skill writes them to a temporary directory and creates no run.
- **`[-c|--config-snapshot <path>]`** (optional): Config snapshot from a harness or parent run, passed to every `config.mjs` and `runs.mjs` call.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the reviewer's method, finding format and severity scale, see [esp-reviewer.md](../../../agents/esp-reviewer.md)
- For the finding classes, see [decision-policy.md](../../../references/decision-policy.md)
- For the reviewer model and effort, see [model-selection.md](../../../references/model-selection.md)

## Core Principles

- Review only the diff. Pre-existing issues outside the changed lines are not findings; a serious one becomes a discovered item
- High signal only: every finding survives a verify pass that tries to prove it wrong, unless `review.verify_findings` is off. The review holds findings and rejected candidates, nothing else: no praise, no general observations
- Every finding carries a location, a dimension, a severity, a class and a fix precise enough to apply without asking
- The skill is read-only and routes nothing: it produces text and a result block, and writes only into the run or temporary directory. The caller decides where the review goes (no PR comments, no inline-comment API calls)
- Run every script with Bash, with the literal `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` path. Counts, result files and the result block always come from `review.mjs` and `runs.mjs`

## Skill-Specific Guidelines

### Configuration

Read the `review` section and the shared defaults once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get review
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get defaults
```

If a command exits with code 1 (invalid config), report its error and stop. If it cannot run at all (no `node`), continue with the defaults.

| Key                        | Default                                                      | Effect                                                   |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `review.dimensions`        | `correctness`, `security`, `conventions`, `plan-conformance` | Dimensions checked when `--focus` names none             |
| `review.min_severity`      | `medium`                                                     | Findings below it are dropped from the review            |
| `review.verify_findings`   | `true`                                                       | Run the verify pass; `false` marks the review unverified |
| `defaults.interactive`     | `off`                                                        | Interactive mode when `--interactive` is not given       |
| `defaults.models.reviewer` | `opus`, effort `high`                                        | Model and effort passed to the `esp-reviewer` subagent   |

The available dimensions are `correctness`, `security`, `plan-conformance`, `tests`, `conventions`, `simplification` and `performance`.

### Scripts

`scripts/review.mjs` resolves the target and parses the review. Every `runs.mjs` call takes `--run-dir <path>` (and `--config-snapshot <path>` when given):

| Moment           | Command                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Resolve target   | `review.mjs target [<target>] --project-dir <repo-root> [--run-dir <path>]` (`<target>`: the `--target` value)         |
| Latest plan      | `runs.mjs plan` (`{ path, version }`, version 0 when there is none)                                                    |
| Pending messages | `runs.mjs messages`, then `runs.mjs deliver <id>...` once applied                                                      |
| Reviewer model   | `runs.mjs update --model reviewer=<alias>[:<effort>]`                                                                  |
| Parse and filter | `review.mjs parse <review_path> --min-severity <level> --verified <bool> --md-out <review_path> --out <findings_path>` |
| User decision    | `runs.mjs decision --json '<decision>'` with `phase: review` and `source: operator`                                    |
| Result block     | The same `parse` command plus `--result`, piped into `runs.mjs result <step>` with `--run-dir`                         |

`target` prints `{ kind, base, head, files, untracked, pr, empty, step, diff_path, review_path, findings_path }`. With `--run-dir`, the paths are `<run-dir>/review-<N>.diff`, `.md` and `.json`, where N is the next review round. `parse` exits 1 with the list of malformed findings when the review does not follow the finding format.

### Running the Reviewer

Build one self-contained prompt for the reviewer:

- The diff file (`diff_path`), base and head, the changed files, and the untracked files, which are not in the diff and must be read in full
- For a pull request: its title, URL and description (`gh pr view <n> --json title,body`)
- The dimensions, the focus text, the minimum severity, and whether to verify
- The plan path and the milestone IDs the diff implements (the `done` milestones in `<run-dir>/state.json`, else every milestone), when there is a plan
- The convention files to honor: `AGENTS.md` and `CLAUDE.md` at the repo root and in every ancestor directory of a changed file
- Operator messages, as an `## Operator Messages` section

Then run it in a fresh context. The choice depends only on the runtime, never on the size of the diff: a small diff still goes to the subagent, because the fresh context keeps the review from being anchored on this session. The review itself needs only file reading and search, so the inline branch works on any runtime.

- **Subagent available** (the session has a subagent tool and is not itself a subagent): spawn `esp-skills:esp-reviewer` in the foreground with the `model` and `effort` from `defaults.models.reviewer`, and wait for its reply before the next step. With `--run-dir`, record the model with `runs.mjs update --model reviewer=<alias>[:<effort>]` before spawning.
- **Otherwise** (a runtime without subagents, or already inside a subagent): read `agents/esp-reviewer.md` in the plugin root and follow its Methodology and Output Guidance in this session, read-only.

Keep only the reviewer's reply. Save it verbatim to `review_path`.

### Interactive Review

In `all` mode, standalone and not headless, after parsing:

1. Show the findings grouped as A, then B-Decide, then B-Scope.
2. For each B-Decide finding, ask which option to apply, with the recommended option first. For each B-Scope finding, ask whether to defer it or keep it in scope.
3. Add a `- Decision: <choice> (user)` line to each answered finding in `review_path`, then parse again. With `--run-dir`, log each answer as a decision with `source: operator`, `phase: review`, the finding ID in `refs`, and its class as `x-esp-class`.

In every other mode the review settles nothing: the fixer applies the classes with the decision policy.

## Instructions

1. **Parse arguments**: read every option by its short or long name. Resolve the interactive mode (`-i|--interactive`, else `defaults.interactive`, `off` when headless).
2. **Load configuration** (see Configuration).
3. **Resolve the target**: run `review.mjs target` with the `--target` value. On exit code 2, report the usage error and stop. If `empty` is true, report that there is nothing to review, end with the result block `{"contract_version":1,"status":"done","summary":"Nothing to review: the diff is empty.","max_risk":"low","outputs":{"findings":0}}` (through `runs.mjs result <step>` with `--run-dir`), and stop.
4. **Resolve the plan**: `--plan`, else with `--run-dir` the path from `runs.mjs plan` when its version is above 0, else none.
5. **Resolve the dimensions**: when every comma-separated item of `--focus` is a dimension name, use those; otherwise use `review.dimensions` and pass `--focus` as the focus text. Remove `plan-conformance` when there is no plan.
6. **Read operator messages**: the injected `## Operator Messages` section, plus `runs.mjs messages` with `--run-dir`.
7. **Run the reviewer** (see Running the Reviewer). Done when its reply is saved verbatim to `review_path` and every inbox message you passed is delivered with `runs.mjs deliver`.
8. **Parse and filter**: run `review.mjs parse` with `--md-out` and `--out` (see Scripts). If it exits 1, correct only the reported headings and lines in `review_path` to the finding format, without changing what the findings say, and parse again. If it still fails, end with `status: failed` and the errors in the summary.
9. **Interactive review** (`all` only, see Interactive Review).
10. **Write the result block**: run the step 8 `parse` command again with `--result`. With `--run-dir`, pipe it into `runs.mjs result <step>` (the `step` from `target`), which records it and prints the final line.
11. **Report**: print the content of `review_path`, then the result line as the final output line.

## Output Guidance

The review markdown, then the result block as the final line:

```markdown
### Review: 3f2a1c0..9b8e7d6

Dimensions: correctness, security, tests. Candidates: 5, verified: 2, rejected: 3.

#### F1 - high - correctness - A

`src/math.js:4-6`: `sum` skips the last element.

- Evidence: the loop runs while `i < xs.length - 1`
- Fix: loop while `i < xs.length` and add a test with three elements

#### F2 - medium - tests - B-Decide

`src/math.js:12`: `divide` has no test for a zero divisor, and its behavior is unspecified.

- Options: throw a `RangeError`; return `Infinity` as today and document it
- Recommended: throw a `RangeError`, which matches `parse()`

#### Rejected Candidates

- `src/math.js:20` missing null check: callers validate input in `src/cli.js:8`
```

```text
{"contract_version":1,"status":"done","summary":"2 findings (1 high, 1 medium), 3 candidates rejected.","max_risk":"high","outputs":{"findings":2,"by_class":{"A":1,"B-Decide":1,"B-Scope":0},"by_severity":{"critical":0,"high":1,"medium":1,"low":0},"rejected":3,"verified":true,"min_severity":"medium","dropped":0,"review_path":"...","findings_path":"..."}}
```

When nothing survives, the review says `No findings.` and still lists the rejected candidates. `outputs.findings_path` points at the parsed findings (`review_format: 1`), which `esp-fix-review --internal` consumes.
