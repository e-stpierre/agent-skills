---
name: esp-recap
description: Recap past esp-skills and harness runs, report their risks, or answer questions about them with sources
argument-hint: "[--risks] [--all] [--since <date>] [--until <date>] [--last <span>] [--repo <name>] [--status <list>] [--risk <level>] [--config-snapshot <path>] [context]"
---

# ESP Recap

## Overview

Tell the user what happened across their runs, what was risky, or why a decision was made, with a source for every statement. The skill reads the run directories that `esp-go`, `esp-go-light`, `esp-build` and a harness leave behind (`run.json`, `summary.md`, `decisions.jsonl`, step results, review findings) under every root in `recap.roots`. It has three modes: recap (the default), risk report (`--risks`), and Q&A when `[context]` is a question. `scripts/recap.mjs` selects the runs and returns compact JSON with the path of each artifact, so the skill reads only what it needs. The skill is read-only: it never writes to a run or the repository.

## Arguments

### Definitions

- **`[--risks]`** (optional): Risk report mode: high-risk decisions, critical findings, and runs that halted or wait for a human.
- **`[--all]`** (optional): No date filter. Without it and without a date option, the recap covers the last `recap.default_range_days` days.
- **`[--since <date>]`** (optional): First day, `YYYY-MM-DD`, matched on the run directory date.
- **`[--until <date>]`** (optional): Last day, `YYYY-MM-DD`.
- **`[--last <span>]`** (optional): Shortcut for `--since`: `<N>d`, `<N>w` or `<N>h` (for example `3d`).
- **`[--repo <name>]`** (optional): Only runs of this repository, matched on the end of the `run.json` `repo` (`api` matches `o/api`).
- **`[--status <list>]`** (optional): Comma-separated `run.json` statuses (`merged`, `halted`, `awaiting-human`, ...).
- **`[--risk <level>]`** (optional): Only runs whose `max_risk` is at least `low`, `medium` or `high`.
- **`[--config-snapshot <path>]`** (optional): Config snapshot from a harness. Used to resolve `recap.*` and `runs.root`.
- **`[context]`** (optional): Empty for a recap of the range; a run ID or run directory path for the recap of one run; a question ("why did we rotate refresh tokens?") for Q&A. With `--risks`, extra words narrow the report.

The date and filter options follow the `runs.mjs index` filters, so a harness and the user filter runs the same way.

### Values

Arguments: $ARGUMENTS

## Additional Resources

- For the run directory layout and the artifacts, see [contract-notes.md](../../../references/contract-notes.md)
- For `summary.md`, see [summary-template.md](../../../references/summary-template.md)
- For decision classes and risk levels, see [decision-policy.md](../../../references/decision-policy.md)

## Core Principles

- Every statement cites its source: a run artifact path (with a line for `decisions.jsonl`), a commit SHA, or a pull request URL. Say "no record" rather than guess
- Read through `recap.mjs`. Open a run file directly only when its path came from the script output
- Read-only: never write, fix, or delete anything in a run directory or the repository
- Answer Q&A from sources in this order, and stop as soon as the question is answered: decisions, summaries, git log and blame, pull request descriptions and comments
- Keep the main context small: above `recap.fan_out_threshold` runs, digest them in parallel subagents and keep only their digests
- Report what the runs say, not what the code does today. When the two may differ, say so and point to the commit

## Skill-Specific Guidelines

### Configuration

Read the section once at the start (add `--config-snapshot <path>` when given):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs" get recap
```

| Key                        | Default                 | Effect                                                                             |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `recap.roots`              | `["~/.esp-skills/runs"]` | Runs roots to read. Add the agentic-forge runs root to recap harness runs too. `runs.root` is always read |
| `recap.default_range_days` | `7`                     | Days covered when no date option is given, today included                          |
| `recap.fan_out_threshold`  | `5`                     | Above this number of runs, digest them in parallel subagents, one batch each       |

If the command exits with code 1 (invalid config), report its error and stop. If `node` is missing, say the skill needs Node 22 and stop.

### Script

`scripts/recap.mjs` takes the filters above (`--since`, `--until`, `--last`, `--all`, `--repo`, `--status`, `--risk`, `--limit <N>`), plus `--config-snapshot`. Every item it returns carries a `source` path.

| Command                                 | Returns                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `collect`                               | `range`, `count`, `fan_out`, `batches` (run paths per subagent), and one digest per run: title, workflow, repo, status, PR, outcome, decision counts by risk, critical findings, steps, commits |
| `show <run-id\|path>`                   | One run in full: `run.json`, summary sections, decisions, step results, commits, critical findings, latest plan path |
| `risks [--min-risk <level>]`            | Decisions at or above the level (default `high`), critical review findings, and halted, blocked, failed or waiting runs |
| `sources --question <text>`             | Q&A candidates in source order: matching decisions and summary sections, then per matching run the repo, branch, commits and files for git, and the PR URLs |

Exit codes: `0` success, `1` failure (for example an unknown run), `2` usage error.

### Workflow Names

A run's `workflow` in the digests comes from `summary.md` when it exists, and `run_workflow` keeps the `run.json` value. They differ for an `esp-go-light` run that escalated and that `esp-go` took over: `run.json` keeps `esp-go-light`, the steps show a `go-light` step (`escalate`) and a `go` step, and the summary says `esp-go`. Report it as "started as esp-go-light, escalated to esp-go". Child runs of an overseer run (`tasks/<id>/`) carry a `parent`; group them under it.

### Fan-Out

When `collect` returns `fan_out: true`, spawn one subagent per entry of `batches`, in parallel, with the Agent tool (`general-purpose`). Each prompt gives the run paths of the batch, the user's question or "recap", and asks the subagent to run `node "<plugin root>/scripts/recap.mjs" show <path>` for each run, read only the files it lists, and return at most 5 lines per run: title, status, what was delivered, the decisions and findings worth attention with their sources. Replace `<plugin root>` with the resolved `${CLAUDE_PLUGIN_ROOT}`. Keep only the returned digests. Without a subagent tool, process the batches one after the other in this session.

## Instructions

1. **Parse arguments**: read the flags, the filter options and `[context]`. The mode is risk report with `--risks`; one-run recap when `[context]` is a run ID or an existing run directory; Q&A when `[context]` is any other text; otherwise recap.
2. **Load configuration** (see Configuration).
3. **Recap mode**:
   1. Run `recap.mjs collect` with the filters. With no run, say which roots and range were read (`roots`, `range`) and suggest `--all` or a wider `--last`.
   2. With `fan_out: true`, digest the batches in subagents (see Fan-Out). Otherwise use the digests as they are, and run `show` on a run only when its digest leaves out something the user asked for.
   3. Write the recap (see Output Guidance).
4. **One-run recap**: run `recap.mjs show <run-id|path>`. Use the summary sections first; read the plan or a step result only when the summary does not answer.
5. **Risk report**: run `recap.mjs risks` with the filters (`--min-risk medium` when the user asks for medium risks too). For each item, open its source only when the line in the output is not enough to explain it. Group by run.
6. **Q&A**:
   1. Run `recap.mjs sources --question "<question>"` with the filters. When it finds nothing in range, run it again with `--all` before giving up.
   2. Decisions: read the top matches; their `rationale` and `alternatives` often answer "why".
   3. Summaries: read the matching sections.
   4. Git: when the answer is still open, in the run's repository (`git` entries give the repo, branch, commits and files), run `git log --oneline <base>..<sha>` or `git show --stat <sha>` for the listed commits, and `git log -L` or `git blame -L <range> <file>` for the lines in question. Skip this step when the repository is not available locally, and say so.
   5. Pull requests: when still open, `gh pr view <url> --json title,body,comments,reviews` for the listed URLs.
   6. Answer with the sources used (see Output Guidance). When the sources disagree, give both and say which is newer.
7. **Report errors**: when the output lists `errors` (unreadable `run.json` files), mention the paths in one line at the end.

## Output Guidance

Answer in plain markdown for the user, short and scannable. Lead with the answer, then the details, then the sources.

- **Recap**: a one-line scope (`5 runs, 2026-11-04 to 2026-11-10, roots: ...`), then one bullet per run grouped by repository: title, workflow, status, PR, one line on the outcome, and the decisions or findings worth attention. End with what needs the user: halted, blocked and `awaiting-human` runs, open follow-ups.
- **Risk report**: one section per severity (🔴 critical findings and high-risk decisions, 🟡 medium when asked), each item with the run, what was decided or found, how it was resolved, and the source. Then the stopped runs.
- **Q&A**: the answer in one to three sentences, then the evidence as a short list, then a `Sources` list.
- **Sources**: use the paths from the script output, `decisions.jsonl:<line>` for decisions, `summary.md#<section>` for summary sections, short SHAs for commits and the full URL for pull requests.

## Templates

```markdown
**Recap**: 3 runs, 2026-11-04 to 2026-11-10 (roots: ~/.esp-skills/runs, ~/.agentic-forge/runs)

### o/api

- **Add token refresh** (esp-go, merged, [#42](https://github.com/o/api/pull/42)): refresh is implemented in three commits. High-risk decision D001: tokens rotate on every use (`.../2026-11-08-add-token-refresh/decisions.jsonl:1`)

### o/web

- **Fix login typo** (started as esp-go-light, escalated to esp-go, halted): stopped on the wall-time budget (`.../2026-11-09-fix-typo/summary.md#Outcome`)

**Needs you**: Fix login typo is halted; resume with `/esp-skills:esp-go --run-dir <path>`.
```

```markdown
Refresh tokens rotate on every use because a stolen token then works only once (D001, high risk). The alternative, keeping tokens for their full lifetime, was rejected.

- Implemented in `abcdef1`, `src/auth/refresh.ts`
- The review raised no objection; PR #42 merged it

**Sources**

- `~/.esp-skills/runs/2026-11-08-add-token-refresh/decisions.jsonl:1`
- `~/.esp-skills/runs/2026-11-08-add-token-refresh/summary.md#Outcome`
- https://github.com/o/api/pull/42
```
